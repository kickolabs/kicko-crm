# Backups and restore

Kicko keeps three independent copies of what matters: the database, the uploaded
documents, and the secrets needed to read encrypted fields. Lose any one of the
three and a restore is incomplete, so all three are covered here.

## 1. Database

**Point-in-time restore (Neon).** Neon keeps a change history, so the database can
be restored to any second inside the plan's history window (check the current
window for your Neon plan; choose one with at least 7 days). Use it for "someone
deleted something an hour ago": restore to a *new branch*, copy what's needed
back, then delete the branch. Never restore over production blindly.

**Nightly logical backup (our own copy).** `npm run db:backup` writes a compressed
`pg_dump` file and, with `BACKUP_BUCKET` set, uploads it to a separate R2/S3
bucket. Keep that bucket in a different account or with separate credentials
from the documents bucket, and turn on object versioning and a lifecycle rule
(e.g. 30 daily, 12 monthly).

| Setting | Meaning |
|---|---|
| `DIRECT_URL` | Owner connection (not the app role) so every table is dumped |
| `BACKUP_BUCKET` | Off-site bucket for dumps (optional locally, required in production) |
| `BACKUP_DIR`, `BACKUP_KEEP` | Local folder and how many local dumps to keep (default 14) |
| `PG_DUMP` | Path to `pg_dump` if it isn't on PATH (use the server's major version) |

It runs nightly from a scheduled job (GitHub Actions, once added). Until then,
run it by hand before risky changes such as migrations.

**Restore a dump** (to a new database first, then switch over):

```sh
createdb kicko_restore
pg_restore --no-owner --no-privileges --dbname="postgresql://…/kicko_restore" backups/kicko-2026-10-22T0100.dump
```

Row-level security policies, the `kicko_app` role's grants and the migration
history are part of the dump. After restoring, run `npm run db:migrate` (no-op if
current) and the RLS tests (`npm test`) against it before pointing the app there.

## 2. Uploaded documents (R2)

Passports and other files live in the documents bucket, not the database. Turn on
**object versioning** (a deleted or overwritten file can be recovered) and a
lifecycle rule that expires *non-current* versions after 90 days. The database
holds each file's storage key, so a database restore and the bucket line up.

## 3. Secrets (store in a password manager, not only in the hosting dashboard)

| Secret | Why it matters |
|---|---|
| `ENCRYPTION_KEY` | Encrypts agencies' integration keys (WhatsApp, payments, telephony). Without it they must all reconnect. |
| `BETTER_AUTH_SECRET` | Signs sessions and encrypts two-step sign-in secrets and backup codes. Without it everyone is signed out and 2FA must be set up again. |
| Database and bucket credentials | Needed to run a restore at all. |

Rotating either key needs a migration plan; don't change them casually.

## Restore drill (every quarter)

1. Restore last night's dump to a scratch database.
2. Run the RLS tests against it and open the app pointed at it.
3. Check counts for a few agencies (leads, clients, documents) against production.
4. Note how long it took. Delete the scratch database.

## What agencies can do themselves

Owners and admins can download everything their agency has (Settings → Security →
Export all data), any time, including when the subscription has lapsed.
