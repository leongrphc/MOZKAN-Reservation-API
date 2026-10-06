import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { authenticate, requireMembership } from '../../shared/access.js';
import { errors, Id, OrganizationParams, security } from '../../shared/schemas.js';

const ManagementQuery = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000, default: 0 })),
  eventId: Type.Optional(Id),
  status: Type.Optional(
    Type.Union(['HELD', 'CONFIRMED', 'CANCELLED', 'EXPIRED'].map((status) => Type.Literal(status))),
  ),
});

const AuditQuery = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000, default: 0 })),
  action: Type.Optional(
    Type.Union(
      [
        'RESERVATION_CREATED',
        'RESERVATION_CONFIRMED',
        'RESERVATION_CANCELLED',
        'RESERVATION_EXPIRED',
      ].map((action) => Type.Literal(action)),
    ),
  ),
});

const EffectiveStatus = Type.Union(
  ['HELD', 'CONFIRMED', 'CANCELLED', 'EXPIRED'].map((status) => Type.Literal(status)),
);

const ManagementReservation = Type.Object({
  id: Id,
  organizationId: Id,
  eventId: Id,
  eventTitle: Type.String(),
  userId: Id,
  userName: Type.String(),
  userEmail: Type.String(),
  seats: Type.Integer(),
  status: EffectiveStatus,
  expiresAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const AuditMetadata = Type.Object(
  {
    seats: Type.Optional(Type.Integer()),
    status: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const AuditLog = Type.Object({
  id: Id,
  action: Type.Union(
    [
      'RESERVATION_CREATED',
      'RESERVATION_CONFIRMED',
      'RESERVATION_CANCELLED',
      'RESERVATION_EXPIRED',
    ].map((action) => Type.Literal(action)),
  ),
  entityId: Id,
  userId: Type.Union([Id, Type.Null()]),
  userName: Type.Union([Type.String(), Type.Null()]),
  eventTitle: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
  metadata: AuditMetadata,
});

const effectiveStatusSql =
  "CASE WHEN r.status = 'HELD' AND r.expires_at <= clock_timestamp() THEN 'EXPIRED' ELSE r.status END";

export async function managementRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  api.get(
    '/api/v1/organizations/:organizationId/management/reservations',
    {
      preHandler: authenticate,
      schema: {
        tags: ['Management'],
        summary: 'List organization reservations; owner or manager only',
        security,
        params: OrganizationParams,
        querystring: ManagementQuery,
        response: { 200: Type.Object({ data: Type.Array(ManagementReservation) }), ...errors },
      },
    },
    async (request) => {
      const organizationId = request.params.organizationId;
      await requireMembership(pool, organizationId, request.user.sub, ['OWNER', 'MANAGER']);

      const values: unknown[] = [organizationId];
      const filters = ['r.organization_id = $1'];
      if (request.query.eventId) {
        values.push(request.query.eventId);
        filters.push(`r.event_id = $${values.length}`);
      }
      if (request.query.status) {
        values.push(request.query.status);
        filters.push(`${effectiveStatusSql} = $${values.length}`);
      }
      values.push(request.query.limit ?? 20, request.query.offset ?? 0);
      const limitIndex = values.length - 1;
      const offsetIndex = values.length;
      const { rows } = await pool.query(
        `SELECT r.id, r.organization_id AS "organizationId", r.event_id AS "eventId",
          e.title AS "eventTitle", r.user_id AS "userId", u.name AS "userName", u.email AS "userEmail",
          r.seats, ${effectiveStatusSql} AS status, r.expires_at AS "expiresAt",
          r.created_at AS "createdAt", r.updated_at AS "updatedAt"
         FROM reservations r
         JOIN events e ON e.id = r.event_id AND e.organization_id = r.organization_id
         JOIN users u ON u.id = r.user_id
         WHERE ${filters.join(' AND ')}
         ORDER BY r.created_at DESC, r.id
         LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
        values,
      );
      return { data: rows };
    },
  );

  api.get(
    '/api/v1/organizations/:organizationId/management/audit-logs',
    {
      preHandler: authenticate,
      schema: {
        tags: ['Management'],
        summary: 'List organization reservation audit logs; owner or manager only',
        security,
        params: OrganizationParams,
        querystring: AuditQuery,
        response: { 200: Type.Object({ data: Type.Array(AuditLog) }), ...errors },
      },
    },
    async (request) => {
      const organizationId = request.params.organizationId;
      await requireMembership(pool, organizationId, request.user.sub, ['OWNER', 'MANAGER']);

      const values: unknown[] = [organizationId];
      const filters = ['a.organization_id = $1'];
      if (request.query.action) {
        values.push(request.query.action);
        filters.push(`a.action = $${values.length}`);
      }
      values.push(request.query.limit ?? 20, request.query.offset ?? 0);
      const limitIndex = values.length - 1;
      const offsetIndex = values.length;
      const { rows } = await pool.query(
        `SELECT a.id, a.action, a.entity_id AS "entityId",
          CASE WHEN a.action = 'RESERVATION_EXPIRED' THEN NULL ELSE a.user_id END AS "userId",
          CASE WHEN a.action = 'RESERVATION_EXPIRED' THEN NULL ELSE u.name END AS "userName",
          e.title AS "eventTitle", a.created_at AS "createdAt",
          jsonb_strip_nulls(jsonb_build_object(
            'seats', CASE WHEN jsonb_typeof(a.metadata->'seats') = 'number' THEN (a.metadata->>'seats')::integer END,
            'status', CASE WHEN jsonb_typeof(a.metadata->'status') = 'string' THEN a.metadata->>'status' END
          )) AS metadata
         FROM audit_logs a
         LEFT JOIN reservations r ON r.id = a.entity_id AND r.organization_id = a.organization_id
         LEFT JOIN events e ON e.id = r.event_id AND e.organization_id = a.organization_id
         LEFT JOIN users u ON u.id = a.user_id
         WHERE ${filters.join(' AND ')}
         ORDER BY a.created_at DESC, a.id
         LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
        values,
      );
      return { data: rows };
    },
  );
}
