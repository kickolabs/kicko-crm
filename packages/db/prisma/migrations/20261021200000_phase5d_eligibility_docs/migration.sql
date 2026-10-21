-- AlterTable
ALTER TABLE "DocumentFile" ADD COLUMN     "aiCheck" JSONB,
ADD COLUMN     "aiStatus" TEXT;

-- CreateTable
CREATE TABLE "EligibilityCheck" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "explanation" JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EligibilityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EligibilityCheck_tenantId_clientId_createdAt_idx" ON "EligibilityCheck"("tenantId", "clientId", "createdAt");

-- AddForeignKey
ALTER TABLE "EligibilityCheck" ADD CONSTRAINT "EligibilityCheck_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Tenant isolation (same policy as migrations/*_rls).
ALTER TABLE "EligibilityCheck" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EligibilityCheck" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EligibilityCheck"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "EligibilityCheck" ADD CONSTRAINT "EligibilityCheck_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE CASCADE;
