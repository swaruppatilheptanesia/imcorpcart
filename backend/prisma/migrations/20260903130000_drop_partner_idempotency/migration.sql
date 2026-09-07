-- DropForeignKey
ALTER TABLE "partner_idempotency_keys" DROP CONSTRAINT "partner_idempotency_keys_partnerId_fkey";

-- DropTable
DROP TABLE "partner_idempotency_keys";

