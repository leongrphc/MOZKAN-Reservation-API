import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Config } from '../../config.js';
import { authenticate, requireMembership } from '../../shared/access.js';
import { AppError } from '../../shared/errors.js';
import {
  errors,
  Id,
  OrganizationParams,
  ReservationParams,
  PageQuery,
  security,
} from '../../shared/schemas.js';
import { createReservation, confirmReservation, cancelReservation } from './service.js';

const Reservation = Type.Object({
  id: Id,
  organizationId: Id,
  eventId: Id,
  userId: Id,
  seats: Type.Integer(),
  status: Type.Union(
    ['HELD', 'CONFIRMED', 'CANCELLED', 'EXPIRED'].map((status) => Type.Literal(status)),
  ),
  expiresAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});
const columns = `id, organization_id AS "organizationId", event_id AS "eventId", user_id AS "userId",
  seats, CASE WHEN status = 'HELD' AND expires_at <= NOW() THEN 'EXPIRED' ELSE status END AS status,
  expires_at AS "expiresAt", created_at AS "createdAt", updated_at AS "updatedAt"`;

export async function reservationRoutes(
  app: FastifyInstance,
  pool: Pool,
  config: Config,
): Promise<void> {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.post(
    '/api/v1/organizations/:organizationId/reservations',
    {
      preHandler: authenticate,
      schema: {
        tags: ['Reservations'],
        summary: 'Hold seats with an idempotency key',
        security,
        params: OrganizationParams,
        headers: Type.Object({
          'idempotency-key': Type.String({
            minLength: 8,
            maxLength: 128,
            pattern: '^[A-Za-z0-9._:-]+$',
          }),
        }),
        body: Type.Object({ eventId: Id, seats: Type.Integer({ minimum: 1, maximum: 10000 }) }),
        response: { 200: Reservation, 201: Reservation, ...errors },
      },
    },
    async (request, reply) => {
      await requireMembership(pool, request.params.organizationId, request.user.sub);
      const result = await createReservation(pool, {
        organizationId: request.params.organizationId,
        userId: request.user.sub,
        eventId: request.body.eventId,
        seats: request.body.seats,
        idempotencyKey: request.headers['idempotency-key'],
        holdMinutes: config.holdMinutes,
      });
      return reply
        .header('Idempotency-Replayed', String(result.replayed))
        .code(result.replayed ? 200 : 201)
        .send(result.reservation);
    },
  );

  api.get(
    '/api/v1/organizations/:organizationId/reservations',
    {
      preHandler: authenticate,
      schema: {
        tags: ['Reservations'],
        summary: 'List your reservations in this organization',
        security,
        params: OrganizationParams,
        querystring: PageQuery,
        response: { 200: Type.Object({ data: Type.Array(Reservation) }), ...errors },
      },
    },
    async (request) => {
      await requireMembership(pool, request.params.organizationId, request.user.sub);
      const { rows } = await pool.query(
        `SELECT ${columns} FROM reservations WHERE organization_id = $1 AND user_id = $2 ORDER BY created_at DESC, id LIMIT $3 OFFSET $4`,
        [
          request.params.organizationId,
          request.user.sub,
          request.query.limit ?? 20,
          request.query.offset ?? 0,
        ],
      );
      return { data: rows };
    },
  );

  api.get(
    '/api/v1/organizations/:organizationId/reservations/:reservationId',
    {
      preHandler: authenticate,
      schema: {
        tags: ['Reservations'],
        summary: 'Get one of your reservations',
        security,
        params: ReservationParams,
        response: { 200: Reservation, ...errors },
      },
    },
    async (request) => {
      await requireMembership(pool, request.params.organizationId, request.user.sub);
      const { rows } = await pool.query(
        `SELECT ${columns} FROM reservations WHERE organization_id = $1 AND user_id = $2 AND id = $3`,
        [request.params.organizationId, request.user.sub, request.params.reservationId],
      );
      if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Reservation not found');
      return rows[0];
    },
  );

  for (const action of ['confirm', 'cancel'] as const) {
    api.post(
      `/api/v1/organizations/:organizationId/reservations/:reservationId/${action}`,
      {
        preHandler: authenticate,
        schema: {
          tags: ['Reservations'],
          summary: `${action === 'confirm' ? 'Confirm a live hold' : 'Cancel a held or confirmed reservation'}; reservation owner only`,
          security,
          params: ReservationParams,
          response: { 200: Reservation, ...errors },
        },
      },
      async (request) => {
        await requireMembership(pool, request.params.organizationId, request.user.sub);
        const fn = action === 'confirm' ? confirmReservation : cancelReservation;
        return fn(pool, {
          organizationId: request.params.organizationId,
          userId: request.user.sub,
          reservationId: request.params.reservationId,
        });
      },
    );
  }
}
