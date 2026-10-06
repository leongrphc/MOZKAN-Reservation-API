import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/shared/password.js';
import {
  cancelReservation,
  confirmReservation,
  createReservation,
  expireHolds,
} from '../src/modules/reservations/service.js';
import type { Config } from '../src/config.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for integration tests');
const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');
if (!databaseName.endsWith('_test'))
  throw new Error('TEST_DATABASE_URL must point to a database whose name ends in _test');

const schema = `mozkan_test_${randomBytes(8).toString('hex')}`;
const config: Config = {
  databaseUrl,
  jwtSecret: 'integration-test-jwt-secret-that-is-long-enough-123456',
  host: '127.0.0.1',
  port: 3000,
  logLevel: 'silent',
  holdMinutes: 10,
  workerIntervalMs: 5000,
};
let admin: Pool;
let pool: Pool;
let app: FastifyInstance;

type Reply = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: any;
};
const json = (reply: {
  statusCode: number;
  headers: Record<string, any>;
  body: string;
}): Reply => ({
  statusCode: reply.statusCode,
  headers: reply.headers,
  body: JSON.parse(reply.body || '{}'),
});

describe('organization management reads', () => {
  it('lets owners and managers see organization bookings while protecting member access', async () => {
    const owner = await user();
    const manager = await user();
    const attendee = await user();
    const outsider = await user();
    const o = await organization(owner.id);
    await member(o, manager.id, 'MANAGER');
    await member(o, attendee.id);
    const e = await event(o, 5);
    const own = await createReservation(pool, {
      organizationId: o,
      userId: owner.id,
      eventId: e,
      seats: 1,
      idempotencyKey: 'management-owner-key',
      holdMinutes: 10,
    });
    await confirmReservation(pool, {
      organizationId: o,
      userId: owner.id,
      reservationId: own.reservation.id,
    });
    const booking = await createReservation(pool, {
      organizationId: o,
      userId: attendee.id,
      eventId: e,
      seats: 2,
      idempotencyKey: 'management-attendee-key',
      holdMinutes: 10,
    });
    const path = `/api/v1/organizations/${o}/management/reservations`;
    for (const token of [owner.token, manager.token]) {
      const result = await req('GET', path, { token });
      assert.equal(result.statusCode, 200);
      assert.equal(result.body.data.length, 2);
      const attendeeBooking = result.body.data.find(
        (row: any) => row.id === booking.reservation.id,
      );
      assert.equal(attendeeBooking.userEmail, attendee.email);
      assert.equal(attendeeBooking.eventTitle, 'Test Event');
      assert.equal(attendeeBooking.seats, 2);
      assert.equal('requestHash' in attendeeBooking, false);
      assert.equal('idempotencyKey' in attendeeBooking, false);
    }
    assert.equal((await req('GET', path, { token: attendee.token })).statusCode, 403);
    assert.equal((await req('GET', path, { token: outsider.token })).statusCode, 404);
    const personal = await req('GET', `/api/v1/organizations/${o}/reservations`, {
      token: attendee.token,
    });
    assert.equal(personal.body.data.length, 1);
    assert.equal(personal.body.data[0].id, booking.reservation.id);
    // A management reader still cannot mutate someone else's reservation.
    assert.equal(
      (
        await req(
          'POST',
          `/api/v1/organizations/${o}/reservations/${booking.reservation.id}/cancel`,
          { token: manager.token },
        )
      ).statusCode,
      404,
    );
    const otherOrg = await organization(outsider.id);
    assert.deepEqual(
      (
        await req('GET', `/api/v1/organizations/${otherOrg}/management/reservations?eventId=${e}`, {
          token: outsider.token,
        })
      ).body.data,
      [],
    );
  });

  it('filters effective expiry and audit actions without leaking internal metadata', async () => {
    const owner = await user();
    const attendee = await user();
    const outsider = await user();
    const o = await organization(owner.id);
    await member(o, attendee.id);
    const e = await event(o, 2);
    const booking = await createReservation(pool, {
      organizationId: o,
      userId: attendee.id,
      eventId: e,
      seats: 1,
      idempotencyKey: 'management-expired-key',
      holdMinutes: 10,
    });
    await pool.query(
      "UPDATE reservations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [booking.reservation.id],
    );
    const path = `/api/v1/organizations/${o}/management`;
    const expired = await req('GET', `${path}/reservations?status=EXPIRED&eventId=${e}`, {
      token: owner.token,
    });
    assert.equal(expired.statusCode, 200);
    assert.equal(expired.body.data.length, 1);
    assert.equal(expired.body.data[0].status, 'EXPIRED');
    await pool.query(
      'UPDATE audit_logs SET metadata = metadata || \'{"request_hash":"private-value"}\'::jsonb WHERE entity_id=$1',
      [booking.reservation.id],
    );
    const created = await req('GET', `${path}/audit-logs?action=RESERVATION_CREATED`, {
      token: owner.token,
    });
    assert.equal(created.statusCode, 200);
    assert.equal(created.body.data.length, 1);
    assert.equal(created.body.data[0].userId, attendee.id);
    assert.deepEqual(created.body.data[0].metadata, { seats: 1, status: 'HELD' });
    assert.equal(JSON.stringify(created.body).includes('private-value'), false);
    await expireHolds(pool);
    const history = await req('GET', `${path}/audit-logs?action=RESERVATION_EXPIRED`, {
      token: owner.token,
    });
    assert.equal(history.body.data.length, 1);
    assert.equal(history.body.data[0].entityId, booking.reservation.id);
    assert.equal(history.body.data[0].userId, null);
    assert.equal(history.body.data[0].userName, null);
    assert.equal(history.body.data[0].eventTitle, 'Test Event');
    assert.equal(
      (await req('GET', `${path}/audit-logs`, { token: attendee.token })).statusCode,
      403,
    );
    assert.equal(
      (await req('GET', `${path}/audit-logs`, { token: outsider.token })).statusCode,
      404,
    );
    const otherOrg = await organization(outsider.id);
    assert.deepEqual(
      (
        await req('GET', `/api/v1/organizations/${otherOrg}/management/audit-logs`, {
          token: outsider.token,
        })
      ).body.data,
      [],
    );
  });

  it('paginates bookings and exposes lifecycle history with validated filters', async () => {
    const owner = await user();
    const o = await organization(owner.id);
    const e = await event(o, 3);
    for (let index = 0; index < 3; index++) {
      const booking = await createReservation(pool, {
        organizationId: o,
        userId: owner.id,
        eventId: e,
        seats: 1,
        idempotencyKey: `management-page-key-${index}`,
        holdMinutes: 10,
      });
      if (index === 0)
        await cancelReservation(pool, {
          organizationId: o,
          userId: owner.id,
          reservationId: booking.reservation.id,
        });
    }
    const path = `/api/v1/organizations/${o}/management`;
    const ids = [];
    for (let offset = 0; offset < 3; offset++) {
      const page = await req('GET', `${path}/reservations?limit=1&offset=${offset}`, {
        token: owner.token,
      });
      assert.equal(page.statusCode, 200);
      assert.equal(page.body.data.length, 1);
      ids.push(page.body.data[0].id);
    }
    assert.equal(new Set(ids).size, 3);
    const cancelled = await req('GET', `${path}/reservations?status=CANCELLED`, {
      token: owner.token,
    });
    assert.equal(cancelled.body.data.length, 1);
    const actions = await req('GET', `${path}/audit-logs?action=RESERVATION_CANCELLED`, {
      token: owner.token,
    });
    assert.equal(actions.body.data.length, 1);
    for (const suffix of [
      '/reservations?status=INVALID',
      '/reservations?eventId=bad',
      '/audit-logs?action=INVALID',
      '/audit-logs?limit=101',
    ]) {
      assert.equal((await req('GET', path + suffix, { token: owner.token })).statusCode, 400);
    }
  });
});
const tokenFor = (id: string) => app.jwt.sign({ sub: id });
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const future = (minutes = 60) => new Date(Date.now() + minutes * 60_000).toISOString();

async function user(email = `${randomUUID()}@example.test`, role = 'MEMBER') {
  const id = randomUUID();
  await pool.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)', [
    id,
    email,
    'Test User',
    await hashPassword('correct horse battery staple'),
  ]);
  return { id, email, token: tokenFor(id), role };
}

async function organization(ownerId: string, name = `Org ${randomUUID()}`) {
  const id = randomUUID();
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [id, name]);
  await pool.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'OWNER')", [
    id,
    ownerId,
  ]);
  return id;
}

async function member(orgId: string, userId: string, role = 'MEMBER') {
  await pool.query('INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,$3)', [
    orgId,
    userId,
    role,
  ]);
}

async function event(orgId: string, capacity = 10, startsAt = future(120)) {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO events(id,organization_id,title,starts_at,ends_at,capacity) VALUES($1,$2,$3,$4,$5,$6)',
    [
      id,
      orgId,
      'Test Event',
      startsAt,
      new Date(new Date(startsAt).getTime() + 3_600_000).toISOString(),
      capacity,
    ],
  );
  return id;
}

async function req(
  method: string,
  url: string,
  options: {
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
    remoteAddress?: string;
  } = {},
): Promise<Reply> {
  const headers = {
    ...(options.body ? { 'content-type': 'application/json' } : {}),
    ...(options.token ? auth(options.token) : {}),
    ...(options.headers ?? {}),
  };
  return json(
    await (app.inject as any)({
      method,
      url,
      headers,
      payload: options.body,
      remoteAddress: options.remoteAddress,
    }),
  );
}

before(async () => {
  admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema},public`,
    max: 20,
  });
  const migration = await readFile(
    resolve(dirname(fileURLToPath(import.meta.url)), '../db/migrations/001_initial.sql'),
    'utf8',
  );
  await pool.query(migration);
  app = await buildApp(config, pool);
  await app.ready();
});

after(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (admin) {
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});

describe('health, auth, and documentation', () => {
  it('reports live and ready health and serves OpenAPI docs', async () => {
    assert.deepEqual((await req('GET', '/health/live')).body, { status: 'ok' });
    assert.equal((await req('GET', '/health/live')).statusCode, 200);
    assert.equal((await req('GET', '/health/ready')).statusCode, 200);
    const home = await app.inject({ method: 'GET', url: '/' });
    assert.equal(home.statusCode, 200);
    assert.match(home.headers['content-type'] as string, /^text\/html/);
    assert.ok(home.headers['content-security-policy']);
    assert.match(home.body, /\/assets\/app\.js/);
    for (const [path, type] of [
      ['/assets/app.css', /^text\/css/],
      ['/assets/app.js', /^text\/javascript/],
    ] as const) {
      const asset = await app.inject({ method: 'GET', url: path });
      assert.equal(asset.statusCode, 200);
      assert.match(asset.headers['content-type'] as string, type);
    }
    const docs = await app.inject({ method: 'GET', url: '/docs' });
    assert.equal(docs.statusCode, 200);
    const spec = await app.inject({ method: 'GET', url: '/docs/json' });
    assert.equal(spec.statusCode, 200);
    const body = JSON.parse(spec.body);
    for (const route of [
      '/api/v1/auth/register',
      '/api/v1/organizations',
      '/api/v1/organizations/{organizationId}/reservations',
    ])
      assert.ok(body.paths[route]);
    assert.equal(body.components.securitySchemes.bearerAuth.scheme, 'bearer');
    assert.ok(
      body.paths['/api/v1/organizations/{organizationId}/reservations'].post.responses['409'],
    );
  });

  it('registers, logs in, rejects duplicates and never returns password material', async () => {
    const email = `${randomUUID()}@example.test`;
    const registered = await req('POST', '/api/v1/auth/register', {
      body: { email, name: ' Alice ', password: 'correct horse battery staple' },
      remoteAddress: '10.0.0.1',
    });
    assert.equal(registered.statusCode, 201);
    assert.equal(registered.body.user.name, 'Alice');
    assert.equal('password' in registered.body, false);
    assert.equal('passwordHash' in registered.body, false);
    const login = await req('POST', '/api/v1/auth/login', {
      body: { email: email.toUpperCase(), password: 'correct horse battery staple' },
      remoteAddress: '10.0.0.2',
    });
    assert.equal(login.statusCode, 200);
    assert.ok(login.body.accessToken);
    assert.equal(login.body.user.email, email);
    assert.equal(
      (
        await req('POST', '/api/v1/auth/login', {
          body: { email, password: 'wrong password surely' },
          remoteAddress: '10.0.0.3',
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await req('POST', '/api/v1/auth/register', {
          body: { email, name: 'Again', password: 'correct horse battery staple' },
          remoteAddress: '10.0.0.4',
        })
      ).statusCode,
      409,
    );
  });

  it('requires a bearer token and validates request headers and bodies', async () => {
    assert.equal((await req('GET', '/api/v1/auth/me')).statusCode, 401);
    const u = await user();
    const o = await organization(u.id);
    const e = await event(o);
    assert.equal(
      (
        await req('POST', `/api/v1/organizations/${o}/reservations`, {
          token: u.token,
          body: { eventId: e, seats: 1 },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await req('POST', `/api/v1/organizations/${o}/reservations`, {
          token: u.token,
          body: { eventId: e, seats: 1 },
          headers: { 'idempotency-key': 'bad key!' },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await req('POST', `/api/v1/organizations/${o}/events`, {
          token: u.token,
          body: { title: 'x', startsAt: 'yesterday', endsAt: 'tomorrow', capacity: 0 },
        })
      ).statusCode,
      400,
    );
  });
});

describe('organization and event isolation', () => {
  it('enforces owner and manager permissions and hides outsider organizations', async () => {
    const owner = await user();
    const outsider = await user();
    const manager = await user();
    const o = await organization(owner.id);
    await member(o, manager.id, 'MANAGER');
    assert.equal(
      (
        await req('POST', `/api/v1/organizations/${o}/members`, {
          token: manager.token,
          body: { email: outsider.email, role: 'MEMBER' },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await req('GET', `/api/v1/organizations/${o}/events`, { token: outsider.token })).statusCode,
      404,
    );
    assert.equal(
      (
        await req('POST', `/api/v1/organizations/${o}/events`, {
          token: manager.token,
          body: { title: 'managed', startsAt: future(), endsAt: future(120), capacity: 2 },
        })
      ).statusCode,
      201,
    );
  });

  it('validates event times and lists only a member organization', async () => {
    const u = await user();
    const o = await organization(u.id);
    const valid = { title: 'Event', startsAt: future(), endsAt: future(120), capacity: 3 };
    assert.equal(
      (
        await req('POST', `/api/v1/organizations/${o}/events`, {
          token: u.token,
          body: { ...valid, startsAt: new Date(Date.now() - 1000).toISOString() },
        })
      ).body.error.code,
      'INVALID_EVENT_TIME',
    );
    const created = await req('POST', `/api/v1/organizations/${o}/events`, {
      token: u.token,
      body: valid,
    });
    assert.equal(created.statusCode, 201);
    const list = await req('GET', `/api/v1/organizations/${o}/events`, { token: u.token });
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].availableSeats, 3);
  });
});

describe('reservation capacity, idempotency, and ownership', () => {
  it('allows exactly one winner when concurrent holds race for the final seat', async () => {
    const owner = await user();
    const o = await organization(owner.id);
    const e = await event(o, 1);
    const users = await Promise.all(Array.from({ length: 20 }, () => user()));
    for (const u of users) await member(o, u.id);
    const replies = await Promise.all(
      users.map((u, i) =>
        req('POST', `/api/v1/organizations/${o}/reservations`, {
          token: u.token,
          body: { eventId: e, seats: 1 },
          headers: { 'idempotency-key': `race-${i}-unique` },
        }),
      ),
    );
    assert.equal(replies.filter((r) => r.statusCode === 201).length, 1);
    assert.equal(replies.filter((r) => r.body.error?.code === 'CAPACITY_EXCEEDED').length, 19);
    const row = await pool.query(
      "SELECT COALESCE(SUM(seats),0)::int AS seats FROM reservations WHERE event_id=$1 AND status IN ('HELD','CONFIRMED')",
      [e],
    );
    assert.equal(Number(row.rows[0].seats), 1);
  });

  it('replays concurrent identical idempotency requests exactly once', async () => {
    const u = await user();
    const o = await organization(u.id);
    const e = await event(o, 3);
    const path = `/api/v1/organizations/${o}/reservations`;
    const replies = await Promise.all(
      Array.from({ length: 12 }, () =>
        req('POST', path, {
          token: u.token,
          body: { eventId: e, seats: 2 },
          headers: { 'idempotency-key': 'same-key-123' },
        }),
      ),
    );
    assert.ok(replies.every((r) => r.statusCode === 201 || r.statusCode === 200));
    assert.equal(new Set(replies.map((r) => r.body.id)).size, 1);
    assert.equal(replies.filter((r) => r.statusCode === 201).length, 1);
    const count = await pool.query(
      'SELECT count(*)::int AS count FROM reservations WHERE organization_id=$1',
      [o],
    );
    assert.equal(count.rows[0].count, 1);
    const conflict = await req('POST', path, {
      token: u.token,
      body: { eventId: e, seats: 1 },
      headers: { 'idempotency-key': 'same-key-123' },
    });
    assert.equal(conflict.statusCode, 409);
  });

  it('rejects concurrent reuse of a key for a different event', async () => {
    const u = await user();
    const o = await organization(u.id);
    const first = await event(o, 2);
    const second = await event(o, 2);
    const replies = await Promise.all(
      [first, second].map((eventId) =>
        req('POST', `/api/v1/organizations/${o}/reservations`, {
          token: u.token,
          body: { eventId, seats: 1 },
          headers: { 'idempotency-key': 'cross-event-key-123' },
        }),
      ),
    );
    assert.equal(replies.filter((r) => r.statusCode === 201).length, 1);
    assert.equal(
      replies.filter((r) => r.statusCode === 409 && r.body.error?.code === 'IDEMPOTENCY_CONFLICT')
        .length,
      1,
    );
  });

  it('treats UUID casing as the same idempotent request under concurrency', async () => {
    const u = await user();
    const o = await organization(u.id);
    const e = await event(o, 3);
    const replies = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        req('POST', `/api/v1/organizations/${o.toUpperCase()}/reservations`, {
          token: u.token,
          body: { eventId: i % 2 ? e.toUpperCase() : e, seats: 1 },
          headers: { 'idempotency-key': 'uppercase-replay-123' },
        }),
      ),
    );
    assert.equal(replies.filter((r) => r.statusCode === 201).length, 1);
    assert.equal(replies.filter((r) => r.statusCode === 200).length, 7);
    assert.equal(new Set(replies.map((r) => r.body.id)).size, 1);
  });

  it('caps a hold at the event start and replays the current reservation state', async () => {
    const u = await user();
    const o = await organization(u.id);
    const startsAt = future(2);
    const e = await event(o, 2, startsAt);
    const path = `/api/v1/organizations/${o}/reservations`;
    const held = await req('POST', path, {
      token: u.token,
      body: { eventId: e, seats: 1 },
      headers: { 'idempotency-key': 'state-replay-key' },
    });
    assert.equal(new Date(held.body.expiresAt).getTime() <= new Date(startsAt).getTime(), true);
    const confirmed = await req('POST', `${path}/${held.body.id}/confirm`, { token: u.token });
    assert.equal(confirmed.body.status, 'CONFIRMED');
    const confirmedReplay = await req('POST', path, {
      token: u.token,
      body: { eventId: e, seats: 1 },
      headers: { 'idempotency-key': 'state-replay-key' },
    });
    assert.equal(confirmedReplay.statusCode, 200);
    assert.equal(confirmedReplay.body.status, 'CONFIRMED');
    const cancelled = await req('POST', `${path}/${held.body.id}/cancel`, { token: u.token });
    assert.equal(cancelled.body.status, 'CANCELLED');
    const cancelledReplay = await req('POST', path, {
      token: u.token,
      body: { eventId: e, seats: 1 },
      headers: { 'idempotency-key': 'state-replay-key' },
    });
    assert.equal(cancelledReplay.statusCode, 200);
    assert.equal(cancelledReplay.body.status, 'CANCELLED');
  });

  it('enforces ownership and hides reservations across organizations and users', async () => {
    const owner = await user();
    const other = await user();
    const outsider = await user();
    const o = await organization(owner.id);
    await member(o, other.id);
    const e = await event(o, 2);
    const held = await req('POST', `/api/v1/organizations/${o}/reservations`, {
      token: owner.token,
      body: { eventId: e, seats: 1 },
      headers: { 'idempotency-key': 'owner-key-123' },
    });
    const id = held.body.id;
    assert.equal(
      (await req('GET', `/api/v1/organizations/${o}/reservations/${id}`, { token: other.token }))
        .statusCode,
      404,
    );
    assert.equal(
      (
        await req('POST', `/api/v1/organizations/${o}/reservations/${id}/confirm`, {
          token: other.token,
        })
      ).statusCode,
      404,
    );
    const otherOrg = await organization(outsider.id);
    assert.equal(
      (
        await req('GET', `/api/v1/organizations/${otherOrg}/reservations/${id}`, {
          token: outsider.token,
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (await req('GET', `/api/v1/organizations/${o}/reservations`, { token: other.token })).body
        .data.length,
      0,
    );
  });

  it('uses the database clock for direct service confirmation', async () => {
    const u = await user();
    const o = await organization(u.id);
    const e = await event(o, 1);
    const input = {
      organizationId: o,
      userId: u.id,
      eventId: e,
      seats: 1,
      idempotencyKey: 'direct-clock-key',
      holdMinutes: 10,
    };
    const created = await createReservation(pool, input);
    const originalNow = Date.now;
    try {
      Date.now = () => originalNow() + 24 * 60 * 60 * 1000;
      const confirmed = await confirmReservation(pool, {
        organizationId: o,
        userId: u.id,
        reservationId: created.reservation.id,
      });
      assert.equal(confirmed.status, 'CONFIRMED');
    } finally {
      Date.now = originalNow;
    }
  });

  it('serializes confirmation, replay, and worker races to one transition audit', async () => {
    const u = await user();
    const o = await organization(u.id);
    const e = await event(o, 1);
    const created = await createReservation(pool, {
      organizationId: o,
      userId: u.id,
      eventId: e,
      seats: 1,
      idempotencyKey: 'transition-race-key',
      holdMinutes: 10,
    });
    const action = { organizationId: o, userId: u.id, reservationId: created.reservation.id };
    const results = await Promise.allSettled([
      confirmReservation(pool, action),
      confirmReservation(pool, action),
      createReservation(pool, {
        organizationId: o,
        userId: u.id,
        eventId: e,
        seats: 1,
        idempotencyKey: 'transition-race-key',
        holdMinutes: 10,
      }),
      expireHolds(pool),
    ]);
    assert.ok(results.every((result) => result.status === 'fulfilled'));
    const row = await pool.query('SELECT status FROM reservations WHERE id=$1', [
      created.reservation.id,
    ]);
    assert.equal(row.rows[0].status, 'CONFIRMED');
    const audits = await pool.query(
      "SELECT count(*)::int AS count FROM audit_logs WHERE entity_id=$1 AND action='RESERVATION_CONFIRMED'",
      [created.reservation.id],
    );
    assert.equal(audits.rows[0].count, 1);
  });

  it('expires a hold from SQL time, rejects confirmation, and frees its seats', async () => {
    const u = await user();
    const v = await user();
    const o = await organization(u.id);
    await member(o, v.id);
    const e = await event(o, 1);
    const held = await req('POST', `/api/v1/organizations/${o}/reservations`, {
      token: u.token,
      body: { eventId: e, seats: 1 },
      headers: { 'idempotency-key': 'expires-key-123' },
    });
    const id = held.body.id;
    await pool.query(
      "UPDATE reservations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [id],
    );
    const confirm = await req('POST', `/api/v1/organizations/${o}/reservations/${id}/confirm`, {
      token: u.token,
    });
    assert.equal(confirm.statusCode, 409);
    assert.equal(confirm.body.error.code, 'HOLD_EXPIRED');
    const expiredReplay = await req('POST', `/api/v1/organizations/${o}/reservations`, {
      token: u.token,
      body: { eventId: e, seats: 1 },
      headers: { 'idempotency-key': 'expires-key-123' },
    });
    assert.equal(expiredReplay.statusCode, 200);
    assert.equal(expiredReplay.body.status, 'EXPIRED');
    const available = await req('GET', `/api/v1/organizations/${o}/events/${e}`, {
      token: u.token,
    });
    assert.equal(available.body.availableSeats, 1);
    const replacement = await req('POST', `/api/v1/organizations/${o}/reservations`, {
      token: v.token,
      body: { eventId: e, seats: 1 },
      headers: { 'idempotency-key': 'replacement-123' },
    });
    assert.equal(replacement.statusCode, 201);
    await pool.query(
      "UPDATE reservations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [replacement.body.id],
    );
    assert.equal(await expireHolds(pool), 1);
    const confirmed = await req(
      'POST',
      `/api/v1/organizations/${o}/reservations/${replacement.body.id}/confirm`,
      { token: v.token },
    );
    assert.equal(confirmed.statusCode, 409);
  });

  it('confirms, cancels idempotently, and replenishes capacity', async () => {
    const u = await user();
    const o = await organization(u.id);
    const e = await event(o, 2);
    const held = await req('POST', `/api/v1/organizations/${o}/reservations`, {
      token: u.token,
      body: { eventId: e, seats: 2 },
      headers: { 'idempotency-key': 'cancel-key-123' },
    });
    const confirmed = await req(
      'POST',
      `/api/v1/organizations/${o}/reservations/${held.body.id}/confirm`,
      { token: u.token },
    );
    assert.equal(confirmed.statusCode, 200);
    assert.equal(confirmed.body.status, 'CONFIRMED');
    const cancelled = await req(
      'POST',
      `/api/v1/organizations/${o}/reservations/${held.body.id}/cancel`,
      { token: u.token },
    );
    assert.equal(cancelled.statusCode, 200);
    assert.equal(cancelled.body.status, 'CANCELLED');
    const replay = await req(
      'POST',
      `/api/v1/organizations/${o}/reservations/${held.body.id}/cancel`,
      { token: u.token },
    );
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body.status, 'CANCELLED');
    const check = await req('GET', `/api/v1/organizations/${o}/events/${e}`, { token: u.token });
    assert.equal(check.body.availableSeats, 2);
  });
});
