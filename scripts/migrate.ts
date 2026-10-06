import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, transaction } from '../src/db.js';
import { loadConfig } from '../src/config.js';

const pool = createPool(loadConfig().databaseUrl);
try {
  await transaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mozkan:migrations', 0))");
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../db/migrations');
    const files = (await readdir(dir)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      const found = await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', [
        version,
      ]);
      if (found.rowCount) continue;
      await client.query(await readFile(resolve(dir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
    }
  });
} finally {
  await pool.end();
}
