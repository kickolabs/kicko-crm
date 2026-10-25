-- Industry packs: the global reference library, per-workspace packs and lists,
-- organizations/openings (employers & vacancies), the credentials vault, and
-- workflow snapshots on cases.

-- AlterEnum
ALTER TYPE "DocumentStatus" ADD VALUE 'EXPIRED';

-- AlterEnum
ALTER TYPE "VisaCategory" ADD VALUE 'OTHER';

-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "closureReason" TEXT,
ADD COLUMN     "feedback" JSONB,
ADD COLUMN     "jobOffer" JSONB,
ADD COLUMN     "nextAction" TEXT,
ADD COLUMN     "openingId" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "packageId" TEXT,
ADD COLUMN     "refs" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "tracks" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "workflow" JSONB;

-- AlterTable
ALTER TABLE "CustomField" ADD COLUMN     "config" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "packId" TEXT,
ADD COLUMN     "system" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "VisaProduct" ADD COLUMN     "info" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "kind" TEXT,
ADD COLUMN     "libraryKey" TEXT,
ADD COLUMN     "libraryVersion" INTEGER,
ADD COLUMN     "packId" TEXT;

-- CreateTable
CREATE TABLE "LibraryItem" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "parentKey" TEXT,
    "name" TEXT NOT NULL,
    "coverage" TEXT,
    "status" TEXT NOT NULL DEFAULT 'published',
    "version" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL DEFAULT '{}',
    "sources" JSONB NOT NULL DEFAULT '[]',
    "unverified" BOOLEAN NOT NULL DEFAULT false,
    "lastReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryChange" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "diff" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantPack" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantLibraryItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentKey" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantLibraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'employer',
    "name" TEXT NOT NULL,
    "country" TEXT,
    "city" TEXT,
    "industry" TEXT,
    "contact" JSONB NOT NULL DEFAULT '{}',
    "data" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opening" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'open',
    "closesAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningCandidate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "openingId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'shortlisted',
    "score" INTEGER,
    "interviewAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpeningCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredentialVault" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT,
    "label" TEXT NOT NULL,
    "portalUrl" TEXT,
    "username" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT,
    "lastRevealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CredentialVault_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LibraryItem_packId_type_parentKey_idx" ON "LibraryItem"("packId", "type", "parentKey");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryItem_packId_type_key_key" ON "LibraryItem"("packId", "type", "key");

-- CreateIndex
CREATE INDEX "LibraryChange_itemId_at_idx" ON "LibraryChange"("itemId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "TenantPack_tenantId_packId_key" ON "TenantPack"("tenantId", "packId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantLibraryItem_tenantId_packId_type_key_key" ON "TenantLibraryItem"("tenantId", "packId", "type", "key");

-- CreateIndex
CREATE INDEX "Organization_tenantId_kind_active_idx" ON "Organization"("tenantId", "kind", "active");

-- CreateIndex
CREATE INDEX "Opening_tenantId_status_idx" ON "Opening"("tenantId", "status");

-- CreateIndex
CREATE INDEX "OpeningCandidate_tenantId_clientId_idx" ON "OpeningCandidate"("tenantId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningCandidate_openingId_clientId_key" ON "OpeningCandidate"("openingId", "clientId");

-- CreateIndex
CREATE INDEX "CredentialVault_tenantId_clientId_idx" ON "CredentialVault"("tenantId", "clientId");

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_openingId_fkey" FOREIGN KEY ("openingId") REFERENCES "Opening"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryChange" ADD CONSTRAINT "LibraryChange_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LibraryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opening" ADD CONSTRAINT "Opening_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningCandidate" ADD CONSTRAINT "OpeningCandidate_openingId_fkey" FOREIGN KEY ("openingId") REFERENCES "Opening"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningCandidate" ADD CONSTRAINT "OpeningCandidate_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialVault" ADD CONSTRAINT "CredentialVault_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Row-level security ─────────────────────────────────────────────────────

-- Tenant tables: isolation, cascade on workspace delete, super-admin read.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['TenantPack', 'TenantLibraryItem', 'Organization', 'Opening', 'OpeningCandidate', 'CredentialVault'] LOOP
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

-- The reference library is global: every workspace may read it, but only the library
-- admin path (app.library_admin = 'on', set by withLibraryWrite) may change it.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['LibraryItem', 'LibraryChange'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY library_read ON %I FOR SELECT USING (true)', t);
    EXECUTE format(
      'CREATE POLICY library_write ON %I FOR INSERT WITH CHECK (current_setting(''app.library_admin'', true) = ''on'')', t);
  END LOOP;
  -- Items can be edited by the library admin; the change log is append-only.
  EXECUTE 'CREATE POLICY library_update ON "LibraryItem" FOR UPDATE
             USING (current_setting(''app.library_admin'', true) = ''on'')
             WITH CHECK (current_setting(''app.library_admin'', true) = ''on'')';
END $$;

-- ─── Backfill ───────────────────────────────────────────────────────────────

ALTER TABLE "Case" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "VisaProduct" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "TenantPack" NO FORCE ROW LEVEL SECURITY;

-- Every existing case keeps the workflow it has today, so later product edits don't move it.
UPDATE "Case" c
SET "workflow" = jsonb_build_object('stages', p.stages, 'checklist', p.checklist, 'productName', p.name)
FROM "VisaProduct" p
WHERE p.id = c."productId" AND c."workflow" IS NULL;

-- Existing products came from the built-in visa catalogue: mark them as the immigration pack's.
UPDATE "VisaProduct" SET "packId" = 'immigration', "libraryKey" = code, "libraryVersion" = 1 WHERE "packId" IS NULL;

-- Every existing workspace is an immigration consultancy.
INSERT INTO "TenantPack" (id, "tenantId", "packId")
SELECT 'tp_' || md5(t.id || 'immigration'), t.id, 'immigration' FROM "Tenant" t
ON CONFLICT ("tenantId", "packId") DO NOTHING;

ALTER TABLE "Case" FORCE ROW LEVEL SECURITY;
ALTER TABLE "VisaProduct" FORCE ROW LEVEL SECURITY;
ALTER TABLE "TenantPack" FORCE ROW LEVEL SECURITY;
