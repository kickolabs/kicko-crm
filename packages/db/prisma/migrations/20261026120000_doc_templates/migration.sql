-- Document templates (agreements, letters) and client e-signing of generated documents.
-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "body" TEXT,
ADD COLUMN     "signature" JSONB,
ADD COLUMN     "templateId" TEXT;

-- CreateTable
CREATE TABLE "DocTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "packId" TEXT,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'letter',
    "signature" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocTemplate_tenantId_active_idx" ON "DocTemplate"("tenantId", "active");

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['DocTemplate'] LOOP
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
