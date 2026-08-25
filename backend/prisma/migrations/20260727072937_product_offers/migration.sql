-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "checkout_group" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "mrp" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "product_offers" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "resellerId" TEXT,
    "eppPrice" DECIMAL(12,2) NOT NULL,
    "smartEppPrice" DECIMAL(12,2),
    "mop" DECIMAL(12,2),
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "freeGiftId" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "product_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_offers_productId_idx" ON "product_offers"("productId");

-- CreateIndex
CREATE INDEX "product_offers_resellerId_idx" ON "product_offers"("resellerId");

-- CreateIndex
CREATE UNIQUE INDEX "product_offers_productId_resellerId_key" ON "product_offers"("productId", "resellerId");

-- CreateIndex
CREATE INDEX "orders_checkout_group_idx" ON "orders"("checkout_group");

-- AddForeignKey
ALTER TABLE "product_offers" ADD CONSTRAINT "product_offers_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_offers" ADD CONSTRAINT "product_offers_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "resellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_offers" ADD CONSTRAINT "product_offers_freeGiftId_fkey" FOREIGN KEY ("freeGiftId") REFERENCES "free_gifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
