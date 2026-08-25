-- AlterTable
ALTER TABLE "products" ADD COLUMN     "sub_category" TEXT;

-- CreateIndex
CREATE INDEX "products_sub_category_idx" ON "products"("sub_category");
