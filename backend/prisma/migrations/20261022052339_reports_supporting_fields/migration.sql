-- AlterTable
ALTER TABLE "order_documents" ADD COLUMN     "issue_note" TEXT;

-- AlterTable
ALTER TABLE "report_exports" ADD COLUMN     "rowCount" INTEGER;

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "delivery_mode" "DeliveryMode";

-- CreateTable
CREATE TABLE "product_views" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "view_count" INTEGER NOT NULL DEFAULT 1,
    "first_viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_views_productId_idx" ON "product_views"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_views_employeeId_productId_key" ON "product_views"("employeeId", "productId");

-- CreateIndex
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");

-- CreateIndex
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status", "createdAt");

-- CreateIndex
CREATE INDEX "report_exports_createdAt_idx" ON "report_exports"("createdAt");

-- AddForeignKey
ALTER TABLE "product_views" ADD CONSTRAINT "product_views_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_views" ADD CONSTRAINT "product_views_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
