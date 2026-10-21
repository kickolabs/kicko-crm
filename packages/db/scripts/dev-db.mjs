// Local Postgres for development, no Docker or installer needed.
// Production uses Neon; only DATABASE_URL / DIRECT_URL change.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dataDir = path.join(root, '.pgdata');
const firstRun = !existsSync(dataDir);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port: 5433,
  persistent: true,
  // Windows defaults to WIN1252; we need UTF-8 for ₹ and non-Latin names.
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

if (firstRun) await pg.initialise();
await pg.start();

const client = pg.getPgClient();
await client.connect();
const { rowCount } = await client.query(`SELECT 1 FROM pg_database WHERE datname = 'kicko'`);
if (!rowCount) await client.query(`CREATE DATABASE kicko ENCODING 'UTF8' TEMPLATE template0`);
// Match production (Neon runs in UTC): Prisma stores UTC in timestamp columns, so
// raw SQL like now() must not use the machine's local timezone.
await client.query(`ALTER DATABASE kicko SET timezone TO 'UTC'`);
// Runtime role: not superuser, not table owner, so RLS always applies to it.
await client.query(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kicko_app') THEN
      CREATE ROLE kicko_app LOGIN PASSWORD 'kicko_app' NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$;`);
await client.end();

console.log('Postgres ready on postgresql://localhost:5433/kicko (Ctrl+C to stop)');

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
