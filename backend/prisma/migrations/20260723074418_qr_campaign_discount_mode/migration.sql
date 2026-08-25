-- CreateEnum
CREATE TYPE "CampaignDiscountMode" AS ENUM ('FIRST_ORDER', 'WHILE_ACTIVE', 'FOREVER');

-- AlterTable
ALTER TABLE "exhibition_campaigns" ADD COLUMN     "discount_mode" "CampaignDiscountMode" NOT NULL DEFAULT 'FIRST_ORDER';
