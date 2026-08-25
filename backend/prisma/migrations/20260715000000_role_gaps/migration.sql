-- DropForeignKey
ALTER TABLE "shipments" DROP CONSTRAINT "shipments_fulfillmentPartnerId_fkey";

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "email_domain" TEXT;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "credit_limit" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "freebie_text" TEXT,
ADD COLUMN     "rating" DOUBLE PRECISION,
ADD COLUMN     "review_count" INTEGER,
ADD COLUMN     "specs" JSONB;

-- AlterTable
ALTER TABLE "shipments" ALTER COLUMN "fulfillmentPartnerId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "carts" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shade" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "carts_employeeId_key" ON "carts"("employeeId");

-- CreateIndex
CREATE INDEX "cart_items_cartId_idx" ON "cart_items"("cartId");

-- CreateIndex
CREATE INDEX "cart_items_productId_idx" ON "cart_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cartId_productId_shade_key" ON "cart_items"("cartId", "productId", "shade");

-- CreateIndex
CREATE UNIQUE INDEX "companies_email_domain_key" ON "companies"("email_domain");

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_fulfillmentPartnerId_fkey" FOREIGN KEY ("fulfillmentPartnerId") REFERENCES "fulfillment_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

