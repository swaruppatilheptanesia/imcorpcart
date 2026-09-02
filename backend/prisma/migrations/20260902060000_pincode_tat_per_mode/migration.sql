-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('APEX', 'DP', 'SURFACE');

-- Clear existing collapsed rows: the table is re-seeded per (pincode × courier ×
-- mode) from the re-extracted Blue Dart TAT sheet. No other table references it.
TRUNCATE TABLE "pincode_tat";

-- DropIndex
DROP INDEX "pincode_tat_pincode_key";

-- AlterTable
ALTER TABLE "pincode_tat" ADD COLUMN     "mode" "DeliveryMode" NOT NULL,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "delivery_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_settings_key_key" ON "delivery_settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "pincode_tat_pincode_courier_mode_key" ON "pincode_tat"("pincode", "courier", "mode");

-- CreateIndex
CREATE INDEX "pincode_tat_pincode_idx" ON "pincode_tat"("pincode");

-- CreateIndex
CREATE INDEX "pincode_tat_mode_idx" ON "pincode_tat"("mode");
