-- Move gift-card (Hubble voucher) issuance state off order_items into its own
-- 1:1 table. Backfill existing voucher lines BEFORE dropping the columns.

-- CreateTable
CREATE TABLE "voucher_fulfilments" (
    "id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "denomination" DECIMAL(12,2) NOT NULL,
    "status" "VoucherFulfilmentStatus" NOT NULL DEFAULT 'PENDING',
    "hubble_order_ref" TEXT,
    "voucher_code" TEXT,
    "voucher_pin" TEXT,
    "voucher_card_type" TEXT,
    "redemption_url" TEXT,
    "voucher_expiry" TIMESTAMP(3),
    "fulfilment_error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voucher_fulfilments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voucher_fulfilments_order_item_id_key" ON "voucher_fulfilments"("order_item_id");

-- CreateIndex
CREATE INDEX "voucher_fulfilments_status_idx" ON "voucher_fulfilments"("status");

-- AddForeignKey
ALTER TABLE "voucher_fulfilments" ADD CONSTRAINT "voucher_fulfilments_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: copy every existing voucher order line into the new table (a line was
-- a voucher iff its fulfilment_status was set to something other than the NONE default).
INSERT INTO "voucher_fulfilments" (
    "id", "order_item_id", "denomination", "status", "hubble_order_ref", "voucher_code",
    "voucher_pin", "voucher_card_type", "redemption_url", "voucher_expiry", "fulfilment_error",
    "delivered_at", "createdAt", "updatedAt"
)
SELECT
    'vf-' || "id", "id", COALESCE("denomination", "unitPrice"), "fulfilment_status", "hubble_order_ref", "voucher_code",
    "voucher_pin", "voucher_card_type", "redemption_url", "voucher_expiry", "fulfilment_error",
    "delivered_at", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "order_items"
WHERE "fulfilment_status" <> 'NONE';

-- DropIndex
DROP INDEX "order_items_fulfilment_status_idx";

-- AlterTable: order_items is a generic order line again
ALTER TABLE "order_items" DROP COLUMN "delivered_at",
DROP COLUMN "denomination",
DROP COLUMN "fulfilment_error",
DROP COLUMN "fulfilment_status",
DROP COLUMN "hubble_order_ref",
DROP COLUMN "redemption_url",
DROP COLUMN "voucher_card_type",
DROP COLUMN "voucher_code",
DROP COLUMN "voucher_expiry",
DROP COLUMN "voucher_pin";
