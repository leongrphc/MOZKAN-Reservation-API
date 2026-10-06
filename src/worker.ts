import { createPool } from './db.js';
import { loadConfig } from './config.js';
import { expireHolds } from './modules/reservations/service.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
let running = true;
let ticking = false;
async function tick() {
  if (!running || ticking) return;
  ticking = true;
  try {
    await expireHolds(pool);
  } catch (error) {
    console.error(
      'reservation expiration tick failed',
      error instanceof Error ? error.message : 'unknown error',
    );
  } finally {
    ticking = false;
  }
}
const timer = setInterval(() => {
  void tick();
}, config.workerIntervalMs);
void tick();
async function shutdown() {
  running = false;
  clearInterval(timer);
  while (ticking) await new Promise((resolve) => setTimeout(resolve, 25));
  await pool.end();
}
process.once('SIGINT', () => {
  void shutdown().then(() => process.exit(0));
});
process.once('SIGTERM', () => {
  void shutdown().then(() => process.exit(0));
});
