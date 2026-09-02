// Seeds the PincodeTat table (Blue Dart) from the compact JSON produced by
// `scripts/extract-bluedart-tat.py`. Idempotent: clears existing Blue Dart rows
// then bulk-inserts. Run: npx ts-node prisma/seed-bluedart-tat.ts
import fs from 'fs';
import path from 'path';
import { PrismaClient, CourierCode, DeliveryMode } from '@prisma/client';

const prisma = new PrismaClient();
const DATA = path.join(__dirname, 'data', 'bluedart-tat.json');
const CHUNK = 2000;

type Entry = { p: string; m: DeliveryMode; t: number; e: 0 | 1; s: 0 | 1 };

async function main() {
  const raw = JSON.parse(fs.readFileSync(DATA, 'utf8')) as Entry[];
  const rows = raw.map((v) => ({
    pincode: v.p,
    courier: CourierCode.BLUEDART,
    mode: v.m,
    tatDays: v.t,
    serviceable: v.s === 1,
    edl: v.e === 1,
    isActive: true,
  }));

  console.log(`Seeding ${rows.length} Blue Dart pincodes…`);
  await prisma.pincodeTat.deleteMany({ where: { courier: CourierCode.BLUEDART } });

  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const res = await prisma.pincodeTat.createMany({ data: batch, skipDuplicates: true });
    inserted += res.count;
  }
  console.log(`Done. Inserted ${inserted} rows.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
