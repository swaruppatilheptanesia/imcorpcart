-- Vendor import pruning: mark products the vendor stopped listing, and record how
-- many a run took off sale.
-- AlterTable
ALTER TABLE "products" ADD COLUMN     "deactivated_by_sync_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "vendor_import_runs" ADD COLUMN     "deactivated" INTEGER NOT NULL DEFAULT 0;
