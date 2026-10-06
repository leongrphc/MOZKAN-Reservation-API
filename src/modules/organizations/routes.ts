import { randomUUID } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { transaction } from '../../db.js';
import { authenticate, requireMembership } from '../../shared/access.js';
import { AppError } from '../../shared/errors.js';
import { errors, Id, OrganizationParams, PageQuery, security } from '../../shared/schemas.js';

const Organization = Type.Object({ id: Id, name: Type.String(), role: Type.String() });

export async function organizationRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.post(
    '/api/v1/organizations',
    {
      preHandler: authenticate,
      schema: {
        tags: ['Organizations'],
        summary: 'Create an organization and become its owner',
        security,
        body: Type.Object({ name: Type.String({ minLength: 1, maxLength: 120, pattern: '\\S' }) }),
        response: { 201: Organization, ...errors },
      },
    },
    async (request, reply) => {
      const organization = { id: randomUUID(), name: request.body.name.trim(), role: 'OWNER' };
      await transaction(pool, async (client) => {
        await client.query('INSERT INTO organizations (id, name) VALUES ($1, $2)', [
          organization.id,
          organization.name,
        ]);
        await client.query(
          "INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'OWNER')",
          [organization.id, request.user.sub],
        );
      });
      return reply.code(201).send(organization);
    },
  );

  api.get(
    '/api/v1/organizations',
    {
      preHandler: authenticate,
      schema: {
        tags: ['Organizations'],
        summary: 'List your organizations',
        security,
        querystring: PageQuery,
        response: { 200: Type.Object({ data: Type.Array(Organization) }), ...errors },
      },
    },
    async (request) => {
      const { rows } = await pool.query(
        'SELECT o.id, o.name, m.role FROM organizations o JOIN memberships m ON m.organization_id = o.id WHERE m.user_id = $1 ORDER BY o.created_at, o.id LIMIT $2 OFFSET $3',
        [request.user.sub, request.query.limit ?? 20, request.query.offset ?? 0],
      );
      return { data: rows };
    },
  );

  api.post(
    '/api/v1/organizations/:organizationId/members',
    {
      preHandler: authenticate,
      schema: {
        tags: ['Organizations'],
        summary: 'Add an existing user; owner only',
        security,
        params: OrganizationParams,
        body: Type.Object({
          email: Type.String({ format: 'email', maxLength: 254 }),
          role: Type.Union([Type.Literal('MANAGER'), Type.Literal('MEMBER')]),
        }),
        response: { 201: Type.Object({ userId: Id, role: Type.String() }), ...errors },
      },
    },
    async (request, reply) => {
      const organizationId = request.params.organizationId;
      await requireMembership(pool, organizationId, request.user.sub, ['OWNER']);
      const { rows } = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
        request.body.email.toLowerCase(),
      ]);
      if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Registered user not found');
      await pool.query(
        'INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)',
        [organizationId, rows[0].id, request.body.role],
      );
      return reply.code(201).send({ userId: rows[0].id, role: request.body.role });
    },
  );
}
