-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "label_url" TEXT,
ADD COLUMN     "last_tracked_at" TIMESTAMP(3),
ADD COLUMN     "next_poll_at" TIMESTAMP(3),
ADD COLUMN     "tracking_error" TEXT;
