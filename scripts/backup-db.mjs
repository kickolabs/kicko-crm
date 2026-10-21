// Nightly logical backup of the Kicko database (in addition to Neon's point-in-time
// restore). Writes a compressed pg_dump file, optionally uploads it to an S3/R2
// bucket, and prunes old local copies. See docs/operations/backups.md.
//
//   npm run db:backup                 → backups/kicko-2026-10-22T0100.dump
//   BACKUP_BUCKET=kicko-backups ...   → also uploaded (S3_* credentials from .env)
//
// Needs PostgreSQL client tools (pg_dump) on PATH, or PG_DUMP=/path/to/pg_dump.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('DIRECT_URL (or DATABASE_URL) is not set. Run through npm run db:backup so .env is loaded.');
  process.exit(1);
}
const pgDump = process.env.PG_DUMP || 'pg_dump';
const probe = spawnSync(pgDump, ['--version'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
  console.error(`pg_dump not found (${pgDump}). Install the PostgreSQL client tools (same major version as the server), or set PG_DUMP to its path.`);
  process.exit(1);
}

const dir = path.resolve(process.env.BACKUP_DIR || 'backups');
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/:/g, '');
const file = path.join(dir, `kicko-${stamp}.dump`);

// Custom format: compressed, restorable table by table with pg_restore.
const dump = spawnSync(pgDump, ['--format=custom', '--compress=9', '--no-owner', '--no-privileges', `--file=${file}`, url], { stdio: 'inherit' });
if (dump.status !== 0) {
  console.error('pg_dump failed.');
  process.exit(dump.status ?? 1);
}
console.log(`Backup written: ${file} (${(statSync(file).size / 1024 / 1024).toFixed(1)} MB)`);

// Optional off-site copy (Cloudflare R2 or any S3).
if (process.env.BACKUP_BUCKET) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '', secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '' },
  });
  await s3.send(new PutObjectCommand({ Bucket: process.env.BACKUP_BUCKET, Key: `db/${path.basename(file)}`, Body: readFileSync(file) }));
  console.log(`Uploaded to ${process.env.BACKUP_BUCKET}/db/${path.basename(file)}`);
}

// Keep the newest N local files (default 14).
const keep = Number(process.env.BACKUP_KEEP || 14);
const old = readdirSync(dir).filter((f) => /^kicko-.*\.dump$/.test(f)).sort().reverse().slice(keep);
for (const f of old) unlinkSync(path.join(dir, f));
if (old.length) console.log(`Removed ${old.length} older local backup(s).`);
