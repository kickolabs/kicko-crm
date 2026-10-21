-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('RECEIVED', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "AutomationTrigger" AS ENUM ('CASE_STAGE', 'DOC_REJECTED', 'INVOICE_ISSUED', 'PAYMENT_OVERDUE', 'PAYMENT_RECEIVED');

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "PortalSession" DROP CONSTRAINT "PortalSession_clientId_fkey";

-- DropForeignKey
ALTER TABLE "PortalSession" DROP CONSTRAINT "PortalSession_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "PortalToken" DROP CONSTRAINT "PortalToken_clientId_fkey";

-- DropForeignKey
ALTER TABLE "PortalToken" DROP CONSTRAINT "PortalToken_tenantId_fkey";

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "waLastInbound" TIMESTAMP(3),
ADD COLUMN     "waOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "waOptInAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "waLastInbound" TIMESTAMP(3),
ADD COLUMN     "waOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "waOptInAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "error" TEXT,
ADD COLUMN     "leadId" TEXT,
ADD COLUMN     "mediaKey" TEXT,
ADD COLUMN     "mediaMime" TEXT,
ADD COLUMN     "mediaName" TEXT,
ADD COLUMN     "mediaType" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "status" "MessageStatus",
ADD COLUMN     "templateName" TEXT,
ALTER COLUMN "clientId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "WhatsAppTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "variables" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "trigger" "AutomationTrigger" NOT NULL,
    "stageKey" TEXT,
    "templateName" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppTemplate_tenantId_name_language_key" ON "WhatsAppTemplate"("tenantId", "name", "language");

-- CreateIndex
CREATE INDEX "Automation_tenantId_trigger_idx" ON "Automation"("tenantId", "trigger");

-- CreateIndex
CREATE INDEX "Message_tenantId_leadId_createdAt_idx" ON "Message"("tenantId", "leadId", "createdAt");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every message belongs to a client or a lead.
ALTER TABLE "Message" ADD CONSTRAINT "Message_contact_check" CHECK ("clientId" IS NOT NULL OR "leadId" IS NOT NULL);

-- Tenant isolation (same policy as migrations/*_rls).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['WhatsAppTemplate', 'Automation'] LOOP
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
