import type { CourierCode, DeliveryMode } from '@/data/api';

/**
 * The courier partners and transport modes, in one place.
 *
 * Both lists mirror Prisma enums (`CourierCode`, `DeliveryMode`) and the labels
 * are the ones the API itself renders — `COURIER_LABELS` / `MODE_LABELS` in
 * backend/src/services/pincode.service.ts — so a code shown here reads the same
 * as the same code shown in a delivery estimate or a pincode row.
 *
 * The courier list predates this module in four screens with three different
 * spellings of "Blue Dart"; new code should import from here.
 */

export const COURIER_OPTIONS: { value: CourierCode; label: string }[] = [
  { value: 'BLUEDART', label: 'Blue Dart' },
  { value: 'DELHIVERY', label: 'Delhivery' },
  { value: 'DTDC', label: 'DTDC' },
  { value: 'EKART', label: 'Ekart' },
  { value: 'INDIA_POST', label: 'India Post' },
];

// APEX = air/priority, DP = domestic priority, SURFACE = ground. The courier
// TAT sheet's own vocabulary, which is why the product field reuses it.
export const MODE_OPTIONS: { value: DeliveryMode; label: string }[] = [
  { value: 'APEX', label: 'Apex' },
  { value: 'DP', label: 'DP' },
  { value: 'SURFACE', label: 'Surface' },
];

export const COURIER_LABEL: Record<string, string> = Object.fromEntries(
  COURIER_OPTIONS.map((c) => [c.value, c.label]),
);

export const MODE_LABEL: Record<string, string> = Object.fromEntries(
  MODE_OPTIONS.map((m) => [m.value, m.label]),
);
