-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cancel_reason" TEXT,
ADD COLUMN     "dealer_code" TEXT,
ADD COLUMN     "dealer_mobile" TEXT,
ADD COLUMN     "dealer_name" TEXT,
ADD COLUMN     "delivery_instructions" TEXT;

