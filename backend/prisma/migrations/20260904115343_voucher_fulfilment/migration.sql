-- CreateEnum
CREATE TYPE "VoucherFulfilmentStatus" AS ENUM ('NONE', 'PENDING', 'PROCESSING', 'DELIVERED', 'FAILED');

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "delivered_at" TIMESTAMP(3),
ADD COLUMN     "denomination" DECIMAL(12,2),
ADD COLUMN     "fulfilment_error" TEXT,
ADD COLUMN     "fulfilment_status" "VoucherFulfilmentStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "hubble_order_ref" TEXT,
ADD COLUMN     "redemption_url" TEXT,
ADD COLUMN     "voucher_card_type" TEXT,
ADD COLUMN     "voucher_code" TEXT,
ADD COLUMN     "voucher_expiry" TIMESTAMP(3),
ADD COLUMN     "voucher_pin" TEXT;

-- CreateIndex
CREATE INDEX "order_items_fulfilment_status_idx" ON "order_items"("fulfilment_status");
