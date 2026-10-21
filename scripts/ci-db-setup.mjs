// CI only: prepare the Postgres service container the way scripts/dev-db.mjs
// prepares the local one (UTC, and the non-superuser kicko_app role that RLS
// applies to). Run after npm ci, before migrations.
import pg from 'pg';

const url = process.env.DIRECT_URL ?? 'postgresql://postgres:postgres@localhost:5433/kicko';
const client = new pg.Client(url);
await client.connect();
await client.query(`ALTER DATABASE kicko SET timezone TO 'UTC'`);
await client.query(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kicko_app') THEN
      CREATE ROLE kicko_app LOGIN PASSWORD 'kicko_app' NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$;`);
await client.end();
console.log('CI database ready');
