-- Kicko's super-admin console reads across agencies. Like app.tenant_id and
-- app.user_id, app.platform_admin is set by the app (only after checking the
-- signed-in user is a Kicko admin) inside a READ ONLY transaction. SELECT only:
-- every write still has to go through one tenant's scope.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT DISTINCT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tenant_isolation'
  LOOP
    EXECUTE format(
      'CREATE POLICY platform_admin_read ON %I FOR SELECT USING (current_setting(''app.platform_admin'', true) = ''on'')', t);
  END LOOP;
END $$;
