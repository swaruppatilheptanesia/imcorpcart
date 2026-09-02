-- CreateEnum
CREATE TYPE "PartnerPriceBasis" AS ENUM ('MRP', 'MOP', 'EPP');

-- AlterTable
ALTER TABLE "partners" DROP COLUMN "catalog_scope";

-- CreateTable
CREATE TABLE "partner_catalogue_entries" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "price_basis" "PartnerPriceBasis" NOT NULL DEFAULT 'MOP',
    "commission_pct" DECIMAL(5,2) DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_catalogue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_catalogue_entries_partnerId_idx" ON "partner_catalogue_entries"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_catalogue_entries_partnerId_productId_key" ON "partner_catalogue_entries"("partnerId", "productId");

-- AddForeignKey
ALTER TABLE "partner_catalogue_entries" ADD CONSTRAINT "partner_catalogue_entries_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_catalogue_entries" ADD CONSTRAINT "partner_catalogue_entries_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

