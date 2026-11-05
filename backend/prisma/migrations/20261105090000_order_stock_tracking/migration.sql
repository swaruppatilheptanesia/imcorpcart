-- Stock is now deducted when an order is placed and restored when it is
-- cancelled. These record that it happened, so a restock is idempotent and
-- orders placed before this change are never restocked.
ALTER TABLE "orders"
  ADD COLUMN "stock_deducted_at" TIMESTAMP(3),
  ADD COLUMN "stock_restored_at" TIMESTAMP(3);
