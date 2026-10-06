import 'dotenv/config';

export interface Config {
  databaseUrl: string;
  jwtSecret: string;
  host: string;
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  holdMinutes: number;
  workerIntervalMs: number;
}

function positiveInteger(name: string, fallback: number, max: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
  return value;
}

export function loadConfig(): Config {
  const databaseUrl = process.env.DATABASE_URL;
  const jwtSecret = process.env.JWT_SECRET;
  if (!databaseUrl || !/^postgres(ql)?:\/\//.test(databaseUrl)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }
  if (!jwtSecret || jwtSecret.length < 32 || jwtSecret.startsWith('replace-this')) {
    throw new Error('JWT_SECRET must be a unique secret of at least 32 characters');
  }
  const logLevel = process.env.LOG_LEVEL ?? 'info';
  if (!['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(logLevel)) {
    throw new Error('LOG_LEVEL is invalid');
  }
  return {
    databaseUrl,
    jwtSecret,
    host: process.env.HOST ?? '127.0.0.1',
    port: positiveInteger('PORT', 3000, 65535),
    logLevel: logLevel as Config['logLevel'],
    holdMinutes: positiveInteger('HOLD_MINUTES', 10, 60),
    workerIntervalMs: positiveInteger('WORKER_INTERVAL_MS', 5000, 300000),
  };
}
