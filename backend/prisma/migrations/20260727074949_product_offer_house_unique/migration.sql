-- Postgres treats NULLs as distinct in the standard @@unique([productId, resellerId])
-- index, so it does NOT stop two first-party/house offers (resellerId IS NULL) on
-- the same product. Enforce one live house offer per product with a partial unique
-- index instead. (Reseller-scoped offers are covered by the regular compound unique.)
CREATE UNIQUE INDEX "product_offers_product_house_unique"
  ON "product_offers" ("productId")
  WHERE "resellerId" IS NULL AND "deletedAt" IS NULL;
