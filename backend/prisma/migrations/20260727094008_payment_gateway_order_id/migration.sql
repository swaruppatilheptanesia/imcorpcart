-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "gateway_order_id" TEXT;

-- CreateIndex
CREATE INDEX "payments_gateway_order_id_idx" ON "payments"("gateway_order_id");
