-- DropForeignKey
ALTER TABLE "vendor_sources" DROP CONSTRAINT "vendor_sources_resellerId_fkey";

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "vendor_sources" DROP COLUMN "auto_publish",
DROP COLUMN "resellerId";

