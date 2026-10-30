-- The transit forms resolve a courier by its code, so every selectable code
-- needs a row here — the seed alone would leave production without them.
INSERT INTO "couriers" ("id", "code", "name", "priority", "active", "createdAt", "updatedAt") VALUES
  ('courier-gati',          'GATI',          'Gati',          'MEDIUM', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('courier-criticallog',   'CRITICALLOG',   'CriticalLog',   'MEDIUM', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('courier-jaydeep',       'JAYDEEP',       'Jaydeep',       'MEDIUM', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('courier-movin',         'MOVIN',         'Movin',         'MEDIUM', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('courier-delhivery-b2b', 'DELHIVERY_B2B', 'Delhivery B2B', 'MEDIUM', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Automatic proof-of-delivery fetch state.
ALTER TABLE "shipments"
  ADD COLUMN "pod_fetch_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pod_next_fetch_at" TIMESTAMP(3),
  ADD COLUMN "pod_fetch_error" TEXT;
