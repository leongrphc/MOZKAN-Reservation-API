import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { Type } from '@sinclair/typebox';
import type { Pool } from 'pg';
import type { Config } from './config.js';
import { createPool } from './db.js';
import { AppError } from './shared/errors.js';
import { errors } from './shared/schemas.js';
import { authRoutes } from './modules/auth/routes.js';
import { organizationRoutes } from './modules/organizations/routes.js';
import { eventRoutes } from './modules/events/routes.js';
import { reservationRoutes } from './modules/reservations/routes.js';
import { uiRoutes } from './ui.js';
import { managementRoutes } from './modules/management/routes.js';

export async function buildApp(config: Config, providedPool?: Pool) {
  const pool = providedPool ?? createPool(config.databaseUrl);
  const app = Fastify({
    bodyLimit: 16 * 1024,
    logger:
      config.logLevel === 'silent'
        ? false
        : {
            level: config.logLevel,
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["idempotency-key"]',
            ],
          },
    ajv: { customOptions: { removeAdditional: false } },
  });
  if (!providedPool)
    app.addHook('onClose', async () => {
      await pool.end();
    });
  await app.register(helmet);
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await app.register(jwt, {
    secret: config.jwtSecret,
    sign: { iss: 'mozkan-api', aud: 'mozkan-api' },
    verify: { allowedIss: 'mozkan-api', allowedAud: 'mozkan-api' },
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'MOZKAN API',
        version: '0.1.0',
        description:
          'Multi-tenant reservation and capacity management. Reserve, confirm, and cancel seats safely.',
      },
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs', staticCSP: true });

  app.setErrorHandler((error, request, reply) => {
    const err = error as Error & {
      validation?: unknown;
      statusCode?: number;
      code?: string;
      constraint?: string;
    };
    let statusCode = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    if (err instanceof AppError) {
      ({ statusCode, code, message } = err);
    } else if (err.validation) {
      statusCode = 400;
      code = 'VALIDATION_ERROR';
      message = err.message;
    } else if (err.code === '23505') {
      statusCode = 409;
      code = 'ALREADY_EXISTS';
      message = 'This resource already exists';
    } else if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      statusCode = err.statusCode;
      code = statusCode === 429 ? 'RATE_LIMITED' : 'BAD_REQUEST';
      message = statusCode === 429 ? 'Too many requests; retry later' : err.message;
    } else {
      request.log.error({ err }, 'Request failed');
    }
    return reply.code(statusCode).send({ error: { code, message, requestId: request.id } });
  });
  app.setNotFoundHandler((request, reply) =>
    reply
      .code(404)
      .send({ error: { code: 'NOT_FOUND', message: 'Route not found', requestId: request.id } }),
  );

  app.get(
    '/health/live',
    {
      schema: {
        tags: ['Health'],
        summary: 'Process liveness',
        response: { 200: Type.Object({ status: Type.Literal('ok') }) },
      },
    },
    async () => ({ status: 'ok' }),
  );
  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['Health'],
        summary: 'Database readiness',
        response: { 200: Type.Object({ status: Type.Literal('ready') }), ...errors },
      },
    },
    async () => {
      try {
        await pool.query('SELECT 1');
      } catch {
        throw new AppError(503, 'NOT_READY', 'Database is unavailable');
      }
      return { status: 'ready' };
    },
  );
  await authRoutes(app, pool);
  await organizationRoutes(app, pool);
  await eventRoutes(app, pool);
  await reservationRoutes(app, pool, config);
  await managementRoutes(app, pool);
  await uiRoutes(app);
  return app;
}
