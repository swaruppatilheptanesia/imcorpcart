import { prisma } from '../config/prisma';
import { COURIER_LABELS, MODE_LABELS, disabledChannels } from './pincode.service';

// Delivery-estimate lookup backed by the PincodeTat table. Given a 6-digit
// destination pincode, returns serviceability + the fastest usable TAT (Active +
// deliverable + not globally disabled) across couriers/modes, the winning
// courier, and a tentative delivery date. Public (works pre-login).
export interface DeliveryEstimate {
  pincode: string;
  courier: string; // winning courier label ('' when not serviceable)
  mode: string | null; // winning mode label
  serviceable: boolean;
  tatDays: number | null;
  edl: boolean; // extended delivery area (EDL/ODA) — reachable but not standard
  etaDate: string | null; // ISO date (today + tatDays)
}

export async function estimateDelivery(pincodeRaw: string): Promise<DeliveryEstimate> {
  const pincode = String(pincodeRaw ?? '').trim();
  const miss: DeliveryEstimate = {
    pincode,
    courier: '',
    mode: null,
    serviceable: false,
    tatDays: null,
    edl: false,
    etaDate: null,
  };
  if (!/^\d{6}$/.test(pincode)) return miss;

  const { couriers, modes } = await disabledChannels();
  const row = await prisma.pincodeTat.findFirst({
    where: {
      pincode,
      serviceable: true,
      isActive: true,
      ...(couriers.length ? { courier: { notIn: couriers } } : {}),
      ...(modes.length ? { mode: { notIn: modes } } : {}),
    },
    orderBy: { tatDays: 'asc' }, // fastest usable row wins
  });
  if (!row) return miss;

  const eta = new Date();
  eta.setHours(0, 0, 0, 0);
  eta.setDate(eta.getDate() + row.tatDays);

  return {
    pincode,
    courier: COURIER_LABELS[row.courier],
    mode: MODE_LABELS[row.mode],
    serviceable: true,
    tatDays: row.tatDays,
    edl: row.edl,
    etaDate: eta.toISOString(),
  };
}
