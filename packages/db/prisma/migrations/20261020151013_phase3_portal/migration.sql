-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('PORTAL', 'WHATSAPP', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "CommissionClaim" DROP CONSTRAINT "CommissionClaim_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Course" DROP CONSTRAINT "Course_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "DocumentFile" DROP CONSTRAINT "DocumentFile_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Installment" DROP CONSTRAINT "Installment_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Institution" DROP CONSTRAINT "Institution_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "InvoiceItem" DROP CONSTRAINT "InvoiceItem_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentLink" DROP CONSTRAINT "PaymentLink_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "ServicePackage" DROP CONSTRAINT "ServicePackage_tenantId_fkey";

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "portalInvitedAt" TIMESTAMP(3),
ADD COLUMN     "portalLastSeen" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT,
    "channel" "MessageChannel" NOT NULL DEFAULT 'PORTAL',
    "direction" "MessageDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "readAt" TIMESTAMP(3),
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Message_externalId_key" ON "Message"("externalId");

-- CreateIndex
CREATE INDEX "Message_tenantId_clientId_createdAt_idx" ON "Message"("tenantId", "clientId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_tenantId_direction_readAt_idx" ON "Message"("tenantId", "direction", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "PortalToken_tokenHash_key" ON "PortalToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PortalToken_tenantId_clientId_idx" ON "PortalToken"("tenantId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "PortalSession_tokenHash_key" ON "PortalSession"("tokenHash");

-- CreateIndex
CREATE INDEX "PortalSession_tenantId_clientId_idx" ON "PortalSession"("tenantId", "clientId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Portal tokens and sessions belong to a client; deleting the client ends access.
ALTER TABLE "PortalToken" ADD CONSTRAINT "PortalToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE;
ALTER TABLE "PortalSession" ADD CONSTRAINT "PortalSession_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE;

-- Tenant isolation (same policy as migrations/*_rls).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Message', 'PortalToken', 'PortalSession'] LOOP
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
