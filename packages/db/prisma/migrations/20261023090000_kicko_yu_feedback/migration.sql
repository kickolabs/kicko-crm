-- CreateTable
CREATE TABLE "AiFeedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "output" JSONB NOT NULL,
    "outcome" JSONB NOT NULL,
    "agreed" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiFeedback_tenantId_task_createdAt_idx" ON "AiFeedback"("tenantId", "task", "createdAt");

-- Tenant isolation, cascade on workspace delete, and the super-admin read policy.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['AiFeedback'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING ("tenantId" = current_setting(''app.tenant_id'', true))
         WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))', t);
    EXECUTE format(
      'CREATE POLICY platform_admin_read ON %I FOR SELECT USING (current_setting(''app.platform_admin'', true) = ''on'')', t);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE CASCADE',
      t, t || '_tenantId_fkey');
  END LOOP;
END $$;
