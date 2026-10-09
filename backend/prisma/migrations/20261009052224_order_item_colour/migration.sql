-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "shade" TEXT,
ADD COLUMN     "substitution" JSONB;

-- AlterTable
ALTER TABLE "smart_epp_request_items" ADD COLUMN     "shade" TEXT;
