-- CreateEnum
CREATE TYPE "CashbackType" AS ENUM ('NONE', 'PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "WalletLedgerType" AS ENUM ('EARN', 'SPEND', 'ADJUST');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cashback_earned" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "wallet_used" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "cashback_type" "CashbackType" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "cashback_value" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_ledger_entries" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "WalletLedgerType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_employeeId_key" ON "wallets"("employeeId");

-- CreateIndex
CREATE INDEX "wallet_ledger_entries_walletId_idx" ON "wallet_ledger_entries"("walletId");

-- CreateIndex
CREATE INDEX "wallet_ledger_entries_referenceType_referenceId_idx" ON "wallet_ledger_entries"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "wallet_ledger_entries_createdAt_idx" ON "wallet_ledger_entries"("createdAt");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
