-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "customFields" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "customFields" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "customFields" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomField_tenantId_entity_idx" ON "CustomField"("tenantId", "entity");

-- CreateIndex
CREATE UNIQUE INDEX "CustomField_tenantId_entity_key_key" ON "CustomField"("tenantId", "entity", "key");

-- CreateIndex
CREATE INDEX "SavedReport_tenantId_idx" ON "SavedReport"("tenantId");


-- Tenant isolation, cascade on workspace delete, and the super-admin read policy.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['CustomField', 'SavedReport'] LOOP
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
