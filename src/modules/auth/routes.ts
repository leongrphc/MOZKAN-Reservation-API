import { randomUUID } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { hashPassword, verifyPassword } from '../../shared/password.js';
import { AppError } from '../../shared/errors.js';
import { authenticate } from '../../shared/access.js';
import { errors, Id, security } from '../../shared/schemas.js';

const Credentials = Type.Object({
  email: Type.String({ format: 'email', maxLength: 254 }),
  password: Type.String({ minLength: 12, maxLength: 128 }),
});
const User = Type.Object({ id: Id, email: Type.String(), name: Type.String() });
const Session = Type.Object({
  accessToken: Type.String(),
  tokenType: Type.Literal('Bearer'),
  expiresIn: Type.Literal(900),
  user: User,
});

export async function authRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  // A real hash keeps missing-user and wrong-password verification on the same expensive path.
  const dummyHash = await hashPassword(randomUUID());
  const session = (user: { id: string; email: string; name: string }) => ({
    accessToken: app.jwt.sign({ sub: user.id }, { expiresIn: '15m' }),
    tokenType: 'Bearer' as const,
    expiresIn: 900 as const,
    user,
  });

  api.post(
    '/api/v1/auth/register',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['Authentication'],
        summary: 'Register a user',
        body: Type.Intersect([
          Credentials,
          Type.Object({ name: Type.String({ minLength: 1, maxLength: 100, pattern: '\\S' }) }),
        ]),
        response: { 201: Session, ...errors },
      },
    },
    async (request, reply) => {
      const { email, password, name } = request.body;
      const user = { id: randomUUID(), email: email.toLowerCase(), name: name.trim() };
      await pool.query(
        'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
        [user.id, user.email, user.name, await hashPassword(password)],
      );
      return reply.code(201).send(session(user));
    },
  );

  api.post(
    '/api/v1/auth/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['Authentication'],
        summary: 'Issue a 15-minute access token',
        body: Credentials,
        response: { 200: Session, ...errors },
      },
    },
    async (request) => {
      const { rows } = await pool.query<{
        id: string;
        email: string;
        name: string;
        password_hash: string;
      }>('SELECT id, email, name, password_hash FROM users WHERE email = $1', [
        request.body.email.toLowerCase(),
      ]);
      const user = rows[0];
      const valid = await verifyPassword(request.body.password, user?.password_hash ?? dummyHash);
      if (!user || !valid)
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
      return session({ id: user.id, email: user.email, name: user.name });
    },
  );

  api.get(
    '/api/v1/auth/me',
    {
      preHandler: authenticate,
      schema: {
        tags: ['Authentication'],
        summary: 'Get the current user',
        security,
        response: { 200: User, ...errors },
      },
    },
    async (request) => {
      const { rows } = await pool.query<{ id: string; email: string; name: string }>(
        'SELECT id, email, name FROM users WHERE id = $1',
        [request.user.sub],
      );
      if (!rows[0]) throw new AppError(401, 'UNAUTHORIZED', 'User no longer exists');
      return rows[0];
    },
  );
}
