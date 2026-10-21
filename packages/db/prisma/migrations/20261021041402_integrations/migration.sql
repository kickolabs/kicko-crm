-- DropForeignKey
ALTER TABLE "Automation" DROP CONSTRAINT "Automation_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "WhatsAppTemplate" DROP CONSTRAINT "WhatsAppTemplate_tenantId_fkey";

-- CreateTable
CREATE TABLE "ProviderConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConnection_tenantId_capability_key" ON "ProviderConnection"("tenantId", "capability");

-- CreateIndex
CREATE INDEX "UsageEvent_tenantId_createdAt_idx" ON "UsageEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageEvent_tenantId_capability_createdAt_idx" ON "UsageEvent"("tenantId", "capability", "createdAt");

-- Move existing connections out of Tenant.settings into ProviderConnection.
-- Secrets were already AES-GCM encrypted per field; they move as-is.
INSERT INTO "ProviderConnection" ("id", "tenantId", "capability", "provider", "config", "createdAt", "updatedAt")
SELECT 'mig_wa_' || t."id", t."id", 'messaging',
       CASE WHEN t."settings"->'whatsapp'->>'mode' = 'live' THEN 'whatsapp-cloud' ELSE 'whatsapp-sandbox' END,
       jsonb_strip_nulls(jsonb_build_object(
         'phoneNumberId', t."settings"->'whatsapp'->>'phoneNumberId',
         'wabaId',        t."settings"->'whatsapp'->>'wabaId',
         'displayNumber', t."settings"->'whatsapp'->>'displayNumber',
         'verifyToken',   t."settings"->'whatsapp'->>'verifyToken',
         'accessToken',   t."settings"->'whatsapp'->>'accessTokenEnc',
         'appSecret',     t."settings"->'whatsapp'->>'appSecretEnc'
       )),
       now(), now()
FROM "Tenant" t WHERE t."settings" ? 'whatsapp';

INSERT INTO "ProviderConnection" ("id", "tenantId", "capability", "provider", "config", "createdAt", "updatedAt")
SELECT 'mig_rzp_' || t."id", t."id", 'payments', 'razorpay',
       jsonb_strip_nulls(jsonb_build_object(
         'keyId',         t."settings"->'razorpay'->>'keyId',
         'keySecret',     t."settings"->'razorpay'->>'keySecretEnc',
         'webhookSecret', t."settings"->'razorpay'->>'webhookSecretEnc'
       )),
       now(), now()
FROM "Tenant" t WHERE t."settings" ? 'razorpay';

UPDATE "Tenant" SET "settings" = "settings" - 'whatsapp' - 'razorpay'
WHERE "settings" ? 'whatsapp' OR "settings" ? 'razorpay';

-- Tenant isolation (same policy as migrations/*_rls).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ProviderConnection', 'UsageEvent'] LOOP
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
