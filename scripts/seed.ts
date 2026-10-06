import { createPool, transaction } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { hashPassword } from '../src/shared/password.js';

if (process.env.NODE_ENV === 'production')
  throw new Error('Refusing to seed demo data in production');
const pool = createPool(loadConfig().databaseUrl);
try {
  await transaction(pool, async (client) => {
    const ownerPassword = await hashPassword('MozkanDemo2026!');
    const memberPassword = await hashPassword('MozkanDemo2026!');
    await client.query(
      `INSERT INTO users(id,email,name,password_hash) VALUES ('00000000-0000-0000-0000-000000000011','owner@mozkan.dev','MOZKAN Owner',$1) ON CONFLICT(email) DO NOTHING`,
      [ownerPassword],
    );
    await client.query(
      `INSERT INTO users(id,email,name,password_hash) VALUES ('00000000-0000-0000-0000-000000000012','member@mozkan.dev','MOZKAN Member',$1) ON CONFLICT(email) DO NOTHING`,
      [memberPassword],
    );
    const owner = await client.query(`SELECT id FROM users WHERE email='owner@mozkan.dev'`);
    const member = await client.query(`SELECT id FROM users WHERE email='member@mozkan.dev'`);
    const organizationId = '00000000-0000-0000-0000-000000000001';
    await client.query(
      `INSERT INTO organizations(id,name) VALUES ($1,'MOZKAN Demo') ON CONFLICT(id) DO NOTHING`,
      [organizationId],
    );
    await client.query(
      `INSERT INTO memberships(organization_id,user_id,role) VALUES ($1,$2,'OWNER'),($1,$3,'MEMBER') ON CONFLICT(organization_id,user_id) DO NOTHING`,
      [organizationId, owner.rows[0].id, member.rows[0].id],
    );
    await client.query(
      `INSERT INTO events(id,organization_id,title,starts_at,ends_at,capacity) VALUES ('00000000-0000-0000-0000-000000000002',$1,'MOZKAN Demo Event',now()+interval '14 days',now()+interval '14 days 2 hours',25) ON CONFLICT(id) DO NOTHING`,
      [organizationId],
    );
  });
} finally {
  await pool.end();
}
