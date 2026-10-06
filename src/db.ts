import { Pool, type PoolClient } from 'pg';

export function createPool(databaseUrl: string): Pool {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    query_timeout: 10_000,
  });
  pool.on('error', (error) =>
    console.error(
      'postgres idle client error',
      error instanceof Error ? error.message : 'unknown error',
    ),
  );
  return pool;
}

export async function transaction<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* preserve original error */
    }
    throw error;
  } finally {
    client.release();
  }
}
