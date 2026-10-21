-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "formAnswers" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "FormRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "keys" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "FormRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FormRequest_tenantId_clientId_status_idx" ON "FormRequest"("tenantId", "clientId", "status");

-- AddForeignKey
ALTER TABLE "FormRequest" ADD CONSTRAINT "FormRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Tenant isolation (same policy as migrations/*_rls).
ALTER TABLE "FormRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FormRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FormRequest"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "FormRequest" ADD CONSTRAINT "FormRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE CASCADE;
