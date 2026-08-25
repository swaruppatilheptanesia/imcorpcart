-- AlterTable
ALTER TABLE "products" ADD COLUMN     "family_key" TEXT,
ADD COLUMN     "option_color" TEXT,
ADD COLUMN     "option_variant" TEXT;

-- CreateIndex
CREATE INDEX "products_family_key_idx" ON "products"("family_key");
