// Shared product-authoring helpers used by both the Super-Admin master authoring
// (product.service) and — for gift validation — reseller offer editing.
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';

export const D = (n: number) => new Prisma.Decimal(n);

export const DEFAULT_G1 = '#dfe3ea';
export const DEFAULT_G2 = '#b3b9c4';

export interface Presentation {
  g1: string;
  g2: string;
  newness: number;
  shades: { name: string; g1: string; g2: string; stock: number }[];
  rows: { k: string; v: string }[];
}

// The subset of a master write that feeds the storefront presentation blob.
export interface MasterPresentationInput {
  g1?: string;
  g2?: string;
  shades?: { name: string; g1: string; g2: string; stock: number }[];
  specRows?: { k: string; v: string }[];
}

// Build the storefront presentation blob (Product.specs) the shop reads. On
// update, unspecified parts fall back to the existing blob so partial writes
// don't wipe shades/specs.
export function buildSpecs(input: MasterPresentationInput, existing?: Partial<Presentation>): Presentation {
  const shades = input.shades ?? existing?.shades ?? [];
  return {
    g1: input.g1 ?? existing?.g1 ?? shades[0]?.g1 ?? DEFAULT_G1,
    g2: input.g2 ?? existing?.g2 ?? shades[0]?.g2 ?? DEFAULT_G2,
    newness: existing?.newness ?? Math.floor(Date.now() / 86_400_000),
    shades,
    rows: input.specRows ?? existing?.rows ?? [],
  };
}

export const colorOptionsFrom = (shades?: { name: string }[]) =>
  shades && shades.length ? shades.map((s) => s.name).join(', ') : null;

// Normalise a family key to a stable slug so sibling SKUs match reliably.
// Shared by admin authoring (product.service) and bulk import (bulk.service) so
// families created either way group together.
export const slugishFamily = (raw: string): string =>
  raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Validate that a free gift belongs to the given reseller (offers are per-seller).
// A null gift is always fine; a null reseller (house offer) may not attach a
// reseller-owned gift.
export async function ensureOwnedGift(
  resellerId: string | null,
  giftId: string | null | undefined,
): Promise<string | null> {
  if (!giftId) return null;
  if (!resellerId) throw AppError.badRequest('A house offer cannot attach a reseller free gift');
  const gift = await prisma.freeGift.findFirst({
    where: { id: giftId, resellerId, deletedAt: null },
    select: { id: true },
  });
  if (!gift) throw AppError.badRequest('Free gift not found for this reseller');
  return gift.id;
}
