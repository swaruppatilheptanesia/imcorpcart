-- AlterTable
ALTER TABLE "products" ADD COLUMN     "about_item" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "country_of_origin" TEXT,
ADD COLUMN     "courier_code" "CourierCode",
ADD COLUMN     "frequently_bought_skus" TEXT,
ADD COLUMN     "in_the_box" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "protection_plan_available" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "protection_plan_pct" DECIMAL(5,2);
