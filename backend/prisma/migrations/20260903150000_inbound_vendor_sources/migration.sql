-- AlterTable
ALTER TABLE "products" ADD COLUMN     "external_ref" TEXT,
ADD COLUMN     "sourceId" TEXT;

-- CreateTable
CREATE TABLE "vendor_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "OrgStatus" NOT NULL DEFAULT 'ONBOARDING',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "adapter" TEXT NOT NULL,
    "base_url" TEXT,
    "api_key_enc" TEXT,
    "api_key_last4" TEXT,
    "config" JSONB,
    "resellerId" TEXT NOT NULL,
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "auto_publish" BOOLEAN NOT NULL DEFAULT false,
    "last_synced_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vendor_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_import_runs" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "started_by_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "vendor_import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendor_sources_slug_key" ON "vendor_sources"("slug");

-- CreateIndex
CREATE INDEX "vendor_sources_status_idx" ON "vendor_sources"("status");

-- CreateIndex
CREATE INDEX "vendor_import_runs_sourceId_idx" ON "vendor_import_runs"("sourceId");

-- CreateIndex
CREATE INDEX "products_sourceId_idx" ON "products"("sourceId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "vendor_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_sources" ADD CONSTRAINT "vendor_sources_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_import_runs" ADD CONSTRAINT "vendor_import_runs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "vendor_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

