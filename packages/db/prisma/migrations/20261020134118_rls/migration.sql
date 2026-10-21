-- Tenant isolation via Postgres row-level security.
-- The app connects as a non-owner role and runs every tenant query inside
-- withTenant(), which sets app.tenant_id for the transaction. When it's unset,
-- current_setting(..., true) is NULL and policies match nothing: deny by default.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Membership', 'Invite', 'Branch', 'Counter', 'VisaProduct', 'Lead', 'Client',
    'FamilyMember', 'Case', 'StageHistory', 'Task', 'Appointment', 'Note',
    'Activity', 'CheckIn'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING ("tenantId" = current_setting(''app.tenant_id'', true))
         WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))', t);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE CASCADE',
      t, t || '_tenantId_fkey');
  END LOOP;
END $$;

-- A signed-in user may list their own memberships across tenants (workspace
-- switcher, post-login redirect). Read-only, and only rows for app.user_id.
CREATE POLICY member_self_read ON "Membership" FOR SELECT
  USING ("userId" = current_setting('app.user_id', true));

-- Runtime role privileges (role is created by scripts/dev-db.mjs locally, or by
-- hand on Neon: CREATE ROLE kicko_app LOGIN PASSWORD '...' NOBYPASSRLS).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kicko_app') THEN
    GRANT USAGE ON SCHEMA public TO kicko_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kicko_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kicko_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kicko_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO kicko_app;
  END IF;
END $$;
