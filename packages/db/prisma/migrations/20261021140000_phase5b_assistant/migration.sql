-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "aiHandoffAt" TIMESTAMP(3),
ADD COLUMN     "aiHandoffReason" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "aiHandoffAt" TIMESTAMP(3),
ADD COLUMN     "aiHandoffReason" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aiMeta" JSONB;

-- CreateTable
CREATE TABLE "KnowledgeItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeItem_tenantId_idx" ON "KnowledgeItem"("tenantId");


-- Tenant isolation (same policy as migrations/*_rls).
ALTER TABLE "KnowledgeItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "KnowledgeItem"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE CASCADE;
