import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { transaction } from '../../db.js';
import { AppError } from '../../shared/errors.js';

export type ReservationStatus = 'HELD' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';
export interface Reservation {
  id: string;
  organizationId: string;
  eventId: string;
  userId: string;
  seats: number;
  status: ReservationStatus;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}
interface ReservationRow {
  id: string;
  organization_id: string;
  event_id: string;
  user_id: string;
  seats: number;
  status: ReservationStatus;
  expires_at: Date | null;
  idempotency_key: string;
  request_hash: string;
  created_at: Date;
  updated_at: Date;
}
interface CreateInput {
  organizationId: string;
  userId: string;
  eventId: string;
  seats: number;
  idempotencyKey: string;
  holdMinutes: number;
}
interface ActionInput {
  organizationId: string;
  userId: string;
  reservationId: string;
}
const fields = `id, organization_id, event_id, user_id, seats, status, expires_at,
  idempotency_key, request_hash, created_at, updated_at`;

function serialize(row: ReservationRow): Reservation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    eventId: row.event_id,
    userId: row.user_id,
    seats: row.seats,
    status: row.status,
    expiresAt: row.expires_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function audit(
  client: PoolClient,
  organizationId: string,
  userId: string,
  action: string,
  entityId: string,
  metadata: object = {},
): Promise<void> {
  await client.query(
    'INSERT INTO audit_logs (organization_id, user_id, action, entity_id, metadata) VALUES ($1, $2, $3, $4, $5)',
    [organizationId, userId, action, entityId, JSON.stringify(metadata)],
  );
}

// Every caller holds the event lock first. State changes and audit inserts share a transaction.
async function expireForEvent(
  client: PoolClient,
  organizationId: string,
  eventId: string,
): Promise<number> {
  const result = await client.query(
    `WITH expired AS (
      UPDATE reservations SET status = 'EXPIRED', updated_at = clock_timestamp()
      WHERE organization_id = $1 AND event_id = $2 AND status = 'HELD'
        AND expires_at <= clock_timestamp()
      RETURNING id, user_id
    ) INSERT INTO audit_logs (organization_id, user_id, action, entity_id)
      SELECT $1, user_id, 'RESERVATION_EXPIRED', id FROM expired RETURNING entity_id`,
    [organizationId, eventId],
  );
  return result.rowCount ?? 0;
}

export async function createReservation(
  pool: Pool,
  raw: CreateInput,
): Promise<{ reservation: Reservation; replayed: boolean }> {
  // PostgreSQL UUID comparison is case insensitive; locks and hashes must use the same identity.
  const input = {
    ...raw,
    organizationId: raw.organizationId.toLowerCase(),
    userId: raw.userId.toLowerCase(),
    eventId: raw.eventId.toLowerCase(),
  };
  if (!Number.isInteger(input.seats) || input.seats < 1 || input.seats > 10000) {
    throw new AppError(400, 'INVALID_SEATS', 'Seats must be an integer between 1 and 10000');
  }
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotencyKey)) {
    throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'A valid idempotency key is required');
  }
  if (!Number.isInteger(input.holdMinutes) || input.holdMinutes < 1 || input.holdMinutes > 60) {
    throw new AppError(
      400,
      'INVALID_HOLD_DURATION',
      'Hold duration must be between 1 and 60 minutes',
    );
  }
  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({
        organizationId: input.organizationId,
        userId: input.userId,
        eventId: input.eventId,
        seats: input.seats,
      }),
    )
    .digest('hex');

  return transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `${input.organizationId}:${input.userId}:${input.idempotencyKey}`,
    ]);
    const previous = await client.query<ReservationRow>(
      `SELECT ${fields} FROM reservations
       WHERE organization_id = $1 AND user_id = $2 AND idempotency_key = $3`,
      [input.organizationId, input.userId, input.idempotencyKey],
    );
    const existing = previous.rows[0];
    if (existing && existing.request_hash !== requestHash) {
      throw new AppError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key was used for a different request',
      );
    }

    const event = await client.query<{ id: string; starts_at: Date; capacity: number }>(
      'SELECT id, starts_at, capacity FROM events WHERE organization_id = $1 AND id = $2 FOR UPDATE',
      [input.organizationId, input.eventId],
    );
    const eventRow = event.rows[0];
    if (!eventRow) throw new AppError(404, 'EVENT_NOT_FOUND', 'Event not found');
    await expireForEvent(client, input.organizationId, input.eventId);

    if (existing) {
      // Reread under the event lock: confirm, cancel and worker may have changed the first snapshot.
      const current = await client.query<ReservationRow>(
        `SELECT ${fields} FROM reservations WHERE id = $1 AND organization_id = $2`,
        [existing.id, input.organizationId],
      );
      return { reservation: serialize(current.rows[0]!), replayed: true };
    }

    const used = await client.query<{ seats: number }>(
      `SELECT COALESCE(SUM(seats), 0)::integer AS seats FROM reservations
       WHERE organization_id = $1 AND event_id = $2
         AND (status = 'CONFIRMED' OR (status = 'HELD' AND expires_at > clock_timestamp()))`,
      [input.organizationId, input.eventId],
    );
    if (used.rows[0]!.seats + input.seats > eventRow.capacity) {
      throw new AppError(409, 'CAPACITY_EXCEEDED', 'Event capacity exceeded');
    }
    const result = await client.query<ReservationRow>(
      `INSERT INTO reservations
        (id, organization_id, event_id, user_id, seats, status, expires_at, idempotency_key, request_hash)
       SELECT $1, $2, $3, $4, $5, 'HELD',
         LEAST(clock_timestamp() + ($6::integer * interval '1 minute'), $9::timestamptz), $7, $8
       WHERE $9::timestamptz > clock_timestamp()
       RETURNING ${fields}`,
      [
        randomUUID(),
        input.organizationId,
        input.eventId,
        input.userId,
        input.seats,
        input.holdMinutes,
        input.idempotencyKey,
        requestHash,
        eventRow.starts_at,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(409, 'EVENT_STARTED', 'Event has already started');
    await audit(client, input.organizationId, input.userId, 'RESERVATION_CREATED', row.id, {
      seats: input.seats,
      status: 'HELD',
    });
    return { reservation: serialize(row), replayed: false };
  });
}

async function lockOwnedEvent(client: PoolClient, input: ActionInput): Promise<void> {
  const result = await client.query(
    `SELECT e.id FROM events e JOIN reservations r
      ON r.event_id = e.id AND r.organization_id = e.organization_id
     WHERE r.organization_id = $1 AND r.id = $2 AND r.user_id = $3 FOR UPDATE OF e`,
    [input.organizationId, input.reservationId, input.userId],
  );
  if (!result.rowCount) throw new AppError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found');
}

async function getOwned(client: PoolClient, input: ActionInput): Promise<ReservationRow> {
  const { rows } = await client.query<ReservationRow>(
    `SELECT ${fields} FROM reservations
     WHERE organization_id = $1 AND id = $2 AND user_id = $3 FOR UPDATE`,
    [input.organizationId, input.reservationId, input.userId],
  );
  if (!rows[0]) throw new AppError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found');
  return rows[0];
}

export async function confirmReservation(pool: Pool, input: ActionInput): Promise<Reservation> {
  return transaction(pool, async (client) => {
    await lockOwnedEvent(client, input);
    const existing = await getOwned(client, input);
    if (existing.status === 'CONFIRMED') return serialize(existing);
    if (existing.status === 'EXPIRED') {
      throw new AppError(409, 'HOLD_EXPIRED', 'Reservation hold has expired');
    }
    if (existing.status !== 'HELD') {
      throw new AppError(409, 'RESERVATION_NOT_ACTIVE', 'Reservation cannot be confirmed');
    }
    // Time is evaluated at the mutation, after locks, rather than in an earlier application check.
    const { rows } = await client.query<ReservationRow>(
      `UPDATE reservations SET status = 'CONFIRMED', expires_at = NULL, updated_at = clock_timestamp()
       WHERE organization_id = $1 AND id = $2 AND user_id = $3 AND status = 'HELD'
         AND expires_at > clock_timestamp()
         AND EXISTS (SELECT 1 FROM events e WHERE e.id = event_id
           AND e.organization_id = $1 AND e.starts_at > clock_timestamp())
       RETURNING ${fields}`,
      [input.organizationId, input.reservationId, input.userId],
    );
    if (!rows[0]) throw new AppError(409, 'HOLD_EXPIRED', 'Reservation hold has expired');
    await audit(client, input.organizationId, input.userId, 'RESERVATION_CONFIRMED', rows[0].id);
    return serialize(rows[0]);
  });
}

export async function cancelReservation(pool: Pool, input: ActionInput): Promise<Reservation> {
  return transaction(pool, async (client) => {
    await lockOwnedEvent(client, input);
    const existing = await getOwned(client, input);
    if (existing.status === 'CANCELLED') return serialize(existing);
    const { rows } = await client.query<ReservationRow>(
      `UPDATE reservations SET status = 'CANCELLED', expires_at = NULL, updated_at = clock_timestamp()
       WHERE organization_id = $1 AND id = $2 AND user_id = $3
         AND (status = 'CONFIRMED' OR (status = 'HELD' AND expires_at > clock_timestamp()))
       RETURNING ${fields}`,
      [input.organizationId, input.reservationId, input.userId],
    );
    if (!rows[0]) throw new AppError(409, 'RESERVATION_EXPIRED', 'Reservation has expired');
    await audit(client, input.organizationId, input.userId, 'RESERVATION_CANCELLED', rows[0].id);
    return serialize(rows[0]);
  });
}

export async function expireHolds(pool: Pool): Promise<number> {
  return transaction(pool, async (client) => {
    const events = await client.query<{ organization_id: string; id: string }>(
      `SELECT e.organization_id, e.id FROM events e WHERE EXISTS (
        SELECT 1 FROM reservations r WHERE r.organization_id = e.organization_id AND r.event_id = e.id
          AND r.status = 'HELD' AND r.expires_at <= clock_timestamp()
       ) ORDER BY e.id LIMIT 100 FOR UPDATE OF e SKIP LOCKED`,
    );
    let count = 0;
    for (const event of events.rows)
      count += await expireForEvent(client, event.organization_id, event.id);
    return count;
  });
}
