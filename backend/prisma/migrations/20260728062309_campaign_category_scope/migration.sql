-- AlterTable
ALTER TABLE "exhibition_campaigns" ADD COLUMN     "categoryId" TEXT;

-- CreateIndex
CREATE INDEX "exhibition_campaigns_categoryId_idx" ON "exhibition_campaigns"("categoryId");

-- AddForeignKey
ALTER TABLE "exhibition_campaigns" ADD CONSTRAINT "exhibition_campaigns_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
