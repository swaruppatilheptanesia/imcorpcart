-- AlterTable
ALTER TABLE "products" ADD COLUMN     "freeGiftId" TEXT;

-- CreateTable
CREATE TABLE "free_gifts" (
    "id" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "free_gifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "free_gifts_resellerId_idx" ON "free_gifts"("resellerId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_freeGiftId_fkey" FOREIGN KEY ("freeGiftId") REFERENCES "free_gifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "free_gifts" ADD CONSTRAINT "free_gifts_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
