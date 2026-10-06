import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { AppError } from './errors.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

export async function authenticate(request: FastifyRequest): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', 'A valid bearer token is required');
  }
}

export async function requireMembership(
  pool: Pool,
  organizationId: string,
  userId: string,
  roles: string[] = ['OWNER', 'MANAGER', 'MEMBER'],
): Promise<void> {
  const { rows } = await pool.query<{ role: string }>(
    'SELECT role FROM memberships WHERE organization_id = $1 AND user_id = $2',
    [organizationId, userId],
  );
  // Hide whether organizations exist from outsiders.
  if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Organization not found');
  if (!roles.includes(rows[0].role)) {
    throw new AppError(403, 'FORBIDDEN', 'Your organization role does not allow this action');
  }
}
