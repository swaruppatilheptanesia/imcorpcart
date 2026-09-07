-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('INTERNAL', 'PARTNER');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_companyId_fkey";

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_employeeId_fkey";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "external_ref" TEXT,
ADD COLUMN     "partner_id" TEXT,
ADD COLUMN     "source" "OrderSource" NOT NULL DEFAULT 'INTERNAL',
ALTER COLUMN "employeeId" DROP NOT NULL,
ALTER COLUMN "companyId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "status" "OrgStatus" NOT NULL DEFAULT 'ONBOARDING',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "api_key" TEXT NOT NULL,
    "api_secret_enc" TEXT NOT NULL,
    "secret_last4" TEXT,
    "ip_allowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "webhook_url" TEXT,
    "catalog_scope" JSONB,
    "price_field" TEXT NOT NULL DEFAULT 'MOP',
    "commission_pct" DECIMAL(5,2) DEFAULT 0,
    "features" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_idempotency_keys" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response_json" JSONB NOT NULL,
    "checkout_group" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "url" TEXT NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "last_attempt_at" TIMESTAMP(3),
    "response_status" INTEGER,
    "last_error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partners_slug_key" ON "partners"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "partners_api_key_key" ON "partners"("api_key");

-- CreateIndex
CREATE INDEX "partners_status_idx" ON "partners"("status");

-- CreateIndex
CREATE UNIQUE INDEX "partner_idempotency_keys_partnerId_key_key" ON "partner_idempotency_keys"("partnerId", "key");

-- CreateIndex
CREATE INDEX "webhook_deliveries_partnerId_idx" ON "webhook_deliveries"("partnerId");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_attempt_at_idx" ON "webhook_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "orders_partner_id_idx" ON "orders"("partner_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_partner_id_external_ref_key" ON "orders"("partner_id", "external_ref");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_idempotency_keys" ADD CONSTRAINT "partner_idempotency_keys_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

