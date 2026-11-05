-- One row per gift card of a voucher line (a line for 2 cards = 2 Hubble orders).
CREATE TABLE "voucher_cards" (
    "id" TEXT NOT NULL,
    "fulfilment_id" TEXT NOT NULL,
    "unit_no" INTEGER NOT NULL,
    "status" "VoucherFulfilmentStatus" NOT NULL DEFAULT 'PENDING',
    "hubble_order_ref" TEXT,
    "code" TEXT,
    "pin" TEXT,
    "card_type" TEXT,
    "expiry" TIMESTAMP(3),
    "amount" DECIMAL(12,2),
    "error" TEXT,
    "refunded_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voucher_cards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "voucher_cards_fulfilment_id_unit_no_key" ON "voucher_cards"("fulfilment_id", "unit_no");
CREATE INDEX "voucher_cards_status_idx" ON "voucher_cards"("status");

ALTER TABLE "voucher_cards" ADD CONSTRAINT "voucher_cards_fulfilment_id_fkey"
  FOREIGN KEY ("fulfilment_id") REFERENCES "voucher_fulfilments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Issued cards: the one credential the old flow kept becomes card 1. A line that
-- paid for more cards gets the rest from prisma/recover-voucher-cards.ts.
INSERT INTO "voucher_cards"
  ("id", "fulfilment_id", "unit_no", "status", "hubble_order_ref", "code", "pin", "card_type", "expiry", "amount", "delivered_at", "updatedAt")
SELECT vf."id" || '-1', vf."id", 1, 'DELIVERED', vf."hubble_order_ref", vf."voucher_code", vf."voucher_pin",
       vf."voucher_card_type", vf."voucher_expiry", vf."denomination", vf."delivered_at", CURRENT_TIMESTAMP
FROM "voucher_fulfilments" vf
WHERE vf."status" = 'DELIVERED';

-- Failed lines were already refunded in full, so every card is stamped as refunded
-- and a later admin retry can't refund it again.
INSERT INTO "voucher_cards"
  ("id", "fulfilment_id", "unit_no", "status", "hubble_order_ref", "error", "refunded_at", "updatedAt")
SELECT vf."id" || '-' || n, vf."id", n, 'FAILED',
       CASE WHEN n = 1 THEN vf."hubble_order_ref" END, vf."fulfilment_error", vf."updatedAt", CURRENT_TIMESTAMP
FROM "voucher_fulfilments" vf
JOIN "order_items" oi ON oi."id" = vf."order_item_id"
CROSS JOIN LATERAL generate_series(1, oi."quantity") AS n
WHERE vf."status" = 'FAILED';
