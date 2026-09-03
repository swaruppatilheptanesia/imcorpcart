-- DropIndex
DROP INDEX "partners_api_key_key";

-- AlterTable
ALTER TABLE "partners" DROP COLUMN "api_key",
DROP COLUMN "api_secret_enc",
DROP COLUMN "secret_last4",
ADD COLUMN     "api_token_hash" TEXT,
ADD COLUMN     "api_token_last4" TEXT,
ADD COLUMN     "webhook_secret_enc" TEXT,
ADD COLUMN     "webhook_secret_last4" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "partners_api_token_hash_key" ON "partners"("api_token_hash");

