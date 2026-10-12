-- CreateIndex
CREATE INDEX "orders_partner_id_updatedAt_idx" ON "orders"("partner_id", "updatedAt");

-- CreateIndex
CREATE INDEX "shipments_updatedAt_idx" ON "shipments"("updatedAt");
