import { Prisma, CourierCode, DeliveryMode } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { serialize } from '../models/serializers';
import { parsePagination, pageMeta } from '../utils/pagination';
import { importPincodeRow } from '../validators/pincode.schema';
import type {
  CreatePincodeInput,
  UpdatePincodeInput,
  PincodeListQuery,
  ImportPincodesInput,
} from '../validators/pincode.schema';

export const COURIER_LABELS: Record<CourierCode, string> = {
  BLUEDART: 'Blue Dart',
  DELHIVERY: 'Delhivery',
  DTDC: 'DTDC',
  EKART: 'Ekart',
  INDIA_POST: 'India Post',
};

export const MODE_LABELS: Record<DeliveryMode, string> = {
  APEX: 'Apex',
  DP: 'DP',
  SURFACE: 'Surface',
};

// ── Pincode master CRUD ──────────────────────────────────────────────────────

export async function listPincodes(query: PincodeListQuery) {
  const p = parsePagination(query);
  const where: Prisma.PincodeTatWhereInput = {
    ...(query.q ? { pincode: { contains: query.q.trim() } } : {}),
    ...(query.courier ? { courier: query.courier } : {}),
    ...(query.mode ? { mode: query.mode } : {}),
    ...(query.serviceable !== undefined ? { serviceable: query.serviceable } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.pincodeTat.findMany({
      where,
      orderBy: [{ pincode: 'asc' }, { courier: 'asc' }, { mode: 'asc' }],
      skip: p.skip,
      take: p.take,
    }),
    prisma.pincodeTat.count({ where }),
  ]);
  return { data: serialize(rows), meta: pageMeta(total, p) };
}

export async function createPincode(input: CreatePincodeInput) {
  try {
    const row = await prisma.pincodeTat.create({
      data: {
        pincode: input.pincode,
        courier: input.courier ?? CourierCode.BLUEDART,
        mode: input.mode,
        tatDays: input.tatDays,
        serviceable: input.serviceable ?? true,
        edl: input.edl ?? false,
        isActive: input.isActive ?? true,
      },
    });
    return serialize(row);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw AppError.conflict('A row for this pincode + courier + mode already exists');
    }
    throw e;
  }
}

export async function updatePincode(id: string, input: UpdatePincodeInput) {
  const existing = await prisma.pincodeTat.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound('Pincode row not found');
  const row = await prisma.pincodeTat.update({
    where: { id },
    data: {
      ...(input.tatDays !== undefined ? { tatDays: input.tatDays } : {}),
      ...(input.serviceable !== undefined ? { serviceable: input.serviceable } : {}),
      ...(input.edl !== undefined ? { edl: input.edl } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  return serialize(row);
}

export async function deletePincode(id: string) {
  const existing = await prisma.pincodeTat.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound('Pincode row not found');
  await prisma.pincodeTat.delete({ where: { id } });
  return { ok: true };
}

// CSV upsert — each raw row is validated individually (per-field errors, one bad
// row never fails the whole file), then created or updated on the composite key.
export async function importPincodes(input: ImportPincodesInput) {
  const result = {
    total: input.rows.length,
    created: 0,
    updated: 0,
    errors: [] as { sku: string; field: string; message: string }[],
  };

  for (let i = 0; i < input.rows.length; i++) {
    const raw = input.rows[i];
    const rawPin = typeof raw.pincode === 'string' ? raw.pincode.trim() : String(raw.pincode ?? '');
    const label = rawPin || `(row ${i + 2})`; // +2 = header row + 1-based

    const parsed = importPincodeRow.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        result.errors.push({ sku: label, field: String(issue.path[0] ?? '—'), message: issue.message });
      }
      continue;
    }
    const row = parsed.data;
    const courier = row.courier ?? CourierCode.BLUEDART;
    const fullLabel = `${row.pincode}/${courier}/${row.mode}`;

    try {
      const data = {
        tatDays: row.tat_days,
        serviceable: row.serviceable ?? true,
        edl: row.edl ?? false,
        isActive: row.is_active ?? true,
      };
      const existing = await prisma.pincodeTat.findUnique({
        where: { pincode_courier_mode: { pincode: row.pincode, courier, mode: row.mode } },
        select: { id: true },
      });
      await prisma.pincodeTat.upsert({
        where: { pincode_courier_mode: { pincode: row.pincode, courier, mode: row.mode } },
        create: { pincode: row.pincode, courier, mode: row.mode, ...data },
        update: data,
      });
      if (existing) result.updated += 1;
      else result.created += 1;
    } catch (e) {
      result.errors.push({ sku: fullLabel, field: '—', message: e instanceof Error ? e.message : 'unknown' });
    }
  }

  return result;
}

export async function listPincodesForExport(query: PincodeListQuery) {
  const where: Prisma.PincodeTatWhereInput = {
    ...(query.q ? { pincode: { contains: query.q.trim() } } : {}),
    ...(query.courier ? { courier: query.courier } : {}),
    ...(query.mode ? { mode: query.mode } : {}),
    ...(query.serviceable !== undefined ? { serviceable: query.serviceable } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
  };
  const rows = await prisma.pincodeTat.findMany({
    where,
    orderBy: [{ pincode: 'asc' }, { courier: 'asc' }, { mode: 'asc' }],
  });
  return serialize(rows);
}

// ── Global courier/mode kill-switches ────────────────────────────────────────

const COURIER_KEYS = Object.values(CourierCode).map((c) => `courier:${c}`);
const MODE_KEYS = Object.values(DeliveryMode).map((m) => `mode:${m}`);
const KNOWN_KEYS = new Set([...COURIER_KEYS, ...MODE_KEYS]);

export async function listDeliverySettings() {
  const rows = await prisma.deliverySetting.findMany();
  const map = new Map(rows.map((r) => [r.key, r.enabled]));
  const couriers = Object.values(CourierCode).map((code) => ({
    key: `courier:${code}`,
    value: code,
    label: COURIER_LABELS[code],
    enabled: map.get(`courier:${code}`) ?? true,
  }));
  const modes = Object.values(DeliveryMode).map((code) => ({
    key: `mode:${code}`,
    value: code,
    label: MODE_LABELS[code],
    enabled: map.get(`mode:${code}`) ?? true,
  }));
  return { couriers, modes };
}

export async function setDeliverySetting(key: string, enabled: boolean) {
  if (!KNOWN_KEYS.has(key)) throw AppError.badRequest('Unknown delivery setting key');
  await prisma.deliverySetting.upsert({
    where: { key },
    create: { key, enabled },
    update: { enabled },
  });
  return listDeliverySettings();
}

// Couriers/modes globally disabled — consumed by the delivery engine.
export async function disabledChannels(): Promise<{ couriers: CourierCode[]; modes: DeliveryMode[] }> {
  const rows = await prisma.deliverySetting.findMany({ where: { enabled: false } });
  const couriers: CourierCode[] = [];
  const modes: DeliveryMode[] = [];
  for (const r of rows) {
    const [kind, value] = r.key.split(':');
    if (kind === 'courier' && value in CourierCode) couriers.push(value as CourierCode);
    if (kind === 'mode' && value in DeliveryMode) modes.push(value as DeliveryMode);
  }
  return { couriers, modes };
}
