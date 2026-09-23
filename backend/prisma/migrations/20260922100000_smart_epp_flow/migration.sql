-- CreateEnum
CREATE TYPE "AdvanceFeeType" AS ENUM ('FIXED', 'PERCENT');

-- DropIndex
DROP INDEX "orders_smartEppRequestId_key";

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "adld_pct" DECIMAL(5,2),
ADD COLUMN     "income_tax_pct" DECIMAL(5,2) NOT NULL DEFAULT 30,
ADD COLUMN     "leasing_company_id" TEXT;

-- AlterTable
ALTER TABLE "lease_schedule_installments" ADD COLUMN     "paid_at" TIMESTAMP(3),
ADD COLUMN     "paid_by_id" TEXT;

-- AlterTable
ALTER TABLE "leasing_companies" ADD COLUMN     "advance_fee_type" "AdvanceFeeType" NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "advance_fee_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "default_tenure_months" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "ptpm" DECIMAL(8,4) NOT NULL DEFAULT 89.5,
ADD COLUMN     "pv_discount_lease_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "pv_discount_repurchase_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "repurchase_pct" DECIMAL(5,2) NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "smart_epp_requests" ADD COLUMN     "addressId" TEXT NOT NULL,
ADD COLUMN     "advance_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "advance_gateway_order_id" TEXT,
ADD COLUMN     "advance_paid_at" TIMESTAMP(3),
ADD COLUMN     "advance_refunded_at" TIMESTAMP(3),
ADD COLUMN     "advance_txn_id" TEXT,
ADD COLUMN     "checkout_group" TEXT,
ADD COLUMN     "companyId" TEXT NOT NULL,
ADD COLUMN     "quote" JSONB;

-- CreateIndex
CREATE INDEX "companies_leasing_company_id_idx" ON "companies"("leasing_company_id");

-- CreateIndex
CREATE INDEX "orders_smartEppRequestId_idx" ON "orders"("smartEppRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "smart_epp_requests_advance_txn_id_key" ON "smart_epp_requests"("advance_txn_id");

-- CreateIndex
CREATE INDEX "smart_epp_requests_companyId_idx" ON "smart_epp_requests"("companyId");

-- CreateIndex
CREATE INDEX "smart_epp_requests_addressId_idx" ON "smart_epp_requests"("addressId");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_leasing_company_id_fkey" FOREIGN KEY ("leasing_company_id") REFERENCES "leasing_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "smart_epp_requests" ADD CONSTRAINT "smart_epp_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "smart_epp_requests" ADD CONSTRAINT "smart_epp_requests_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

