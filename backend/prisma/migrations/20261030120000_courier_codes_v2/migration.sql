-- Couriers tracked by the H. K. Data Services aggregator's updated API, and a
-- document source for proofs of delivery fetched from it. Enum values only:
-- Postgres cannot use a value added in the same transaction, so the courier
-- rows that reference these codes are inserted by the next migration.
ALTER TYPE "CourierCode" ADD VALUE IF NOT EXISTS 'GATI';
ALTER TYPE "CourierCode" ADD VALUE IF NOT EXISTS 'CRITICALLOG';
ALTER TYPE "CourierCode" ADD VALUE IF NOT EXISTS 'JAYDEEP';
ALTER TYPE "CourierCode" ADD VALUE IF NOT EXISTS 'MOVIN';
ALTER TYPE "CourierCode" ADD VALUE IF NOT EXISTS 'DELHIVERY_B2B';

ALTER TYPE "DocumentSource" ADD VALUE IF NOT EXISTS 'COURIER';
