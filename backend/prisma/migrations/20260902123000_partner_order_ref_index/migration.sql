-- DropIndex
DROP INDEX "orders_partner_id_external_ref_key";

-- CreateIndex
CREATE INDEX "orders_partner_id_external_ref_idx" ON "orders"("partner_id", "external_ref");

