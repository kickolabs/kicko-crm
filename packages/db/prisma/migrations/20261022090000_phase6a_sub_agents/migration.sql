-- AlterEnum
ALTER TYPE "LeadSource" ADD VALUE 'SUB_AGENT';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "subAgentId" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "subAgentId" TEXT;

-- CreateTable
CREATE TABLE "SubAgent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "city" TEXT,
    "commissionType" TEXT NOT NULL DEFAULT 'PERCENT',
    "commissionValue" INTEGER NOT NULL DEFAULT 1000,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "portalLastSeen" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubAgentCommission" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subAgentId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "paymentId" TEXT,
    "kind" TEXT NOT NULL,
    "basis" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'DUE',
    "paidAt" TIMESTAMP(3),
    "paidRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubAgentCommission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubAgentToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subAgentId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubAgentToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubAgentSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subAgentId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubAgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubAgent_tenantId_ref_key" ON "SubAgent"("tenantId", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "SubAgent_tenantId_email_key" ON "SubAgent"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "SubAgentCommission_paymentId_key" ON "SubAgentCommission"("paymentId");

-- CreateIndex
CREATE INDEX "SubAgentCommission_tenantId_subAgentId_status_idx" ON "SubAgentCommission"("tenantId", "subAgentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SubAgentToken_tokenHash_key" ON "SubAgentToken"("tokenHash");

-- CreateIndex
CREATE INDEX "SubAgentToken_tenantId_subAgentId_idx" ON "SubAgentToken"("tenantId", "subAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "SubAgentSession_tokenHash_key" ON "SubAgentSession"("tokenHash");

-- CreateIndex
CREATE INDEX "SubAgentSession_tenantId_subAgentId_idx" ON "SubAgentSession"("tenantId", "subAgentId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_subAgentId_fkey" FOREIGN KEY ("subAgentId") REFERENCES "SubAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_subAgentId_fkey" FOREIGN KEY ("subAgentId") REFERENCES "SubAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubAgentCommission" ADD CONSTRAINT "SubAgentCommission_subAgentId_fkey" FOREIGN KEY ("subAgentId") REFERENCES "SubAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Tenant isolation (same policy as migrations/*_rls).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['SubAgent', 'SubAgentCommission', 'SubAgentToken', 'SubAgentSession'] LOOP
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
