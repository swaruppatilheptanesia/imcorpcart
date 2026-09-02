-- AlterTable
ALTER TABLE "products" ADD COLUMN     "gst_percent" DECIMAL(5,2),
ADD COLUMN     "hsn_code" TEXT,
ADD COLUMN     "terms_text" TEXT,
ADD COLUMN     "warranty_text" TEXT;

-- CreateTable
CREATE TABLE "pincode_tat" (
    "id" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "courier" "CourierCode" NOT NULL DEFAULT 'BLUEDART',
    "tat_days" INTEGER NOT NULL,
    "serviceable" BOOLEAN NOT NULL DEFAULT true,
    "edl" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pincode_tat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pincode_tat_pincode_key" ON "pincode_tat"("pincode");

-- CreateIndex
CREATE INDEX "pincode_tat_courier_idx" ON "pincode_tat"("courier");
