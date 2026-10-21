-- Restore "delete with the workspace" on every tenant table. The phase 2 migration
-- dropped the hand-added *_tenantId_fkey constraints, so deleting a Tenant left its
-- rows behind. AdminAction is excluded on purpose: the admin log outlives agencies.
DO $$
DECLARE
  t text;
  tabs text[];
  pass int := 0;
  left_over bigint;
  n bigint;
BEGIN
  SELECT array_agg(c.table_name::text) INTO tabs
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.column_name = 'tenantId' AND c.table_name NOT IN ('AdminAction')
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint k
      WHERE k.conrelid = format('%I', c.table_name)::regclass AND k.contype = 'f' AND k.confrelid = '"Tenant"'::regclass
    );
  IF tabs IS NULL THEN RETURN; END IF;

  -- RLS is forced on these tables; the owner must see every row to clean up.
  FOREACH t IN ARRAY tabs LOOP
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  -- Remove rows of workspaces that no longer exist. Rows referenced by other
  -- orphans are retried on the next pass, after their dependants are gone.
  LOOP
    pass := pass + 1;
    left_over := 0;
    FOREACH t IN ARRAY tabs LOOP
      BEGIN
        EXECUTE format('DELETE FROM %I x WHERE NOT EXISTS (SELECT 1 FROM "Tenant" WHERE id = x."tenantId")', t);
      EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN NULL;
      END;
      EXECUTE format('SELECT count(*) FROM %I x WHERE NOT EXISTS (SELECT 1 FROM "Tenant" WHERE id = x."tenantId")', t) INTO n;
      left_over := left_over + n;
    END LOOP;
    EXIT WHEN left_over = 0;
    IF pass >= 20 THEN RAISE EXCEPTION 'Could not remove % orphaned tenant rows', left_over; END IF;
  END LOOP;

  FOREACH t IN ARRAY tabs LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE CASCADE', t, t || '_tenantId_fkey');
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
