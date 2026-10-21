-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'pro',
    "interval" TEXT NOT NULL DEFAULT 'year',
    "status" TEXT NOT NULL DEFAULT 'trialing',
    "statusSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seats" INTEGER NOT NULL DEFAULT 3,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "discountPct" INTEGER NOT NULL DEFAULT 0,
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "topUpCredits" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "providerSubscriptionId" TEXT,
    "pendingChange" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "action" TEXT,
    "credits" INTEGER NOT NULL,
    "fromTopUp" INTEGER NOT NULL DEFAULT 0,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformInvoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "cgst" INTEGER NOT NULL DEFAULT 0,
    "sgst" INTEGER NOT NULL DEFAULT 0,
    "igst" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "providerPaymentId" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformCounter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "PlatformCounter_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_providerSubscriptionId_key" ON "Subscription"("providerSubscriptionId");

-- CreateIndex
CREATE INDEX "CreditEntry_tenantId_kind_createdAt_idx" ON "CreditEntry"("tenantId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformInvoice_number_key" ON "PlatformInvoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformInvoice_providerPaymentId_key" ON "PlatformInvoice"("providerPaymentId");

-- CreateIndex
CREATE INDEX "PlatformInvoice_tenantId_paidAt_idx" ON "PlatformInvoice"("tenantId", "paidAt");


-- Existing workspaces (built before billing) get a complimentary active Pro plan.
INSERT INTO "Subscription" (id, "tenantId", plan, interval, status, seats, provider, "currentPeriodEnd", "createdAt", "updatedAt")
SELECT 'sub_' || t.id, t.id, 'pro', 'year', 'active', 25, 'manual', now() + interval '10 years', now(), now()
FROM "Tenant" t;

-- Tenant isolation (same policy as migrations/*_rls). PlatformCounter is global.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Subscription', 'CreditEntry', 'PlatformInvoice'] LOOP
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
