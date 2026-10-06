import { randomUUID } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { authenticate, requireMembership } from '../../shared/access.js';
import { AppError } from '../../shared/errors.js';
import {
  errors,
  Id,
  EventParams,
  OrganizationParams,
  PageQuery,
  security,
} from '../../shared/schemas.js';

const Event = Type.Object({
  id: Id,
  organizationId: Id,
  title: Type.String(),
  startsAt: Type.String({ format: 'date-time' }),
  endsAt: Type.String({ format: 'date-time' }),
  capacity: Type.Integer(),
  availableSeats: Type.Integer(),
});
const selectEvents = `SELECT e.id, e.organization_id AS "organizationId", e.title,
  e.starts_at AS "startsAt", e.ends_at AS "endsAt", e.capacity,
  (e.capacity - COALESCE((SELECT SUM(r.seats) FROM reservations r WHERE r.event_id = e.id
    AND (r.status = 'CONFIRMED' OR (r.status = 'HELD' AND r.expires_at > NOW()))), 0))::integer AS "availableSeats"
  FROM events e`;

export async function eventRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.post(
    '/api/v1/organizations/:organizationId/events',
    {
      preHandler: authenticate,
      schema: {
        tags: ['Events'],
        summary: 'Create a fixed-capacity event; owner or manager',
        security,
        params: OrganizationParams,
        body: Type.Object({
          title: Type.String({ minLength: 1, maxLength: 160, pattern: '\\S' }),
          startsAt: Type.String({ format: 'date-time' }),
          endsAt: Type.String({ format: 'date-time' }),
          capacity: Type.Integer({ minimum: 1, maximum: 10000 }),
        }),
        response: { 201: Event, ...errors },
      },
    },
    async (request, reply) => {
      const organizationId = request.params.organizationId;
      await requireMembership(pool, organizationId, request.user.sub, ['OWNER', 'MANAGER']);
      const { title, startsAt, endsAt, capacity } = request.body;
      if (Date.parse(startsAt) <= Date.now() || Date.parse(endsAt) <= Date.parse(startsAt)) {
        throw new AppError(
          400,
          'INVALID_EVENT_TIME',
          'Start must be in the future and end must be after start',
        );
      }
      const id = randomUUID();
      await pool.query(
        'INSERT INTO events (id, organization_id, title, starts_at, ends_at, capacity) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, organizationId, title.trim(), startsAt, endsAt, capacity],
      );
      return reply.code(201).send({
        id,
        organizationId,
        title: title.trim(),
        startsAt,
        endsAt,
        capacity,
        availableSeats: capacity,
      });
    },
  );

  api.get(
    '/api/v1/organizations/:organizationId/events',
    {
      preHandler: authenticate,
      schema: {
        tags: ['Events'],
        summary: 'List events with current capacity',
        security,
        params: OrganizationParams,
        querystring: PageQuery,
        response: { 200: Type.Object({ data: Type.Array(Event) }), ...errors },
      },
    },
    async (request) => {
      await requireMembership(pool, request.params.organizationId, request.user.sub);
      const { rows } = await pool.query(
        `${selectEvents} WHERE e.organization_id = $1 ORDER BY e.starts_at, e.id LIMIT $2 OFFSET $3`,
        [request.params.organizationId, request.query.limit ?? 20, request.query.offset ?? 0],
      );
      return { data: rows };
    },
  );

  api.get(
    '/api/v1/organizations/:organizationId/events/:eventId',
    {
      preHandler: authenticate,
      schema: {
        tags: ['Events'],
        summary: 'Get event availability; authoritative capacity is checked on reservation',
        security,
        params: EventParams,
        response: { 200: Event, ...errors },
      },
    },
    async (request) => {
      await requireMembership(pool, request.params.organizationId, request.user.sub);
      const { rows } = await pool.query(
        `${selectEvents} WHERE e.organization_id = $1 AND e.id = $2`,
        [request.params.organizationId, request.params.eventId],
      );
      if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Event not found');
      return rows[0];
    },
  );
}
