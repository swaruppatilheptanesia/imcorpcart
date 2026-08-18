import { nanoid } from 'nanoid';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { serialize } from '../models/serializers';
import type { CreateCampaignInput, UpdateCampaignInput } from '../validators/campaign.schema';

// QR exhibition campaigns (Super Admin). Scanning the QR opens the registration
// page with ?qr=<qrToken>; registering through a live campaign flags the user
// for the campaign's discount (see auth.service register + shop.service placeOrder).

// Scope (category) surfaced on every campaign response for the admin UI.
const campaignInclude = {
  category: { select: { id: true, name: true, slug: true } },
  _count: { select: { users: true, orders: true } },
};

export async function listCampaigns() {
  const rows = await prisma.exhibitionCampaign.findMany({
    orderBy: { createdAt: 'desc' },
    include: campaignInclude,
  });
  return { data: serialize(rows) };
}

export async function createCampaign(input: CreateCampaignInput) {
  const campaign = await prisma.exhibitionCampaign.create({
    data: {
      name: input.name,
      qrToken: nanoid(12),
      discountPercent: input.discountPercent,
      discountMode: input.discountMode ?? 'FIRST_ORDER',
      status: input.status ?? 'DRAFT',
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      categoryId: input.categoryId ?? null,
    },
    include: campaignInclude,
  });
  return serialize(campaign);
}

export async function updateCampaign(id: string, input: UpdateCampaignInput) {
  const existing = await prisma.exhibitionCampaign.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound('Campaign not found');
  const campaign = await prisma.exhibitionCampaign.update({
    where: { id },
    data: {
      name: input.name,
      discountPercent: input.discountPercent,
      discountMode: input.discountMode,
      status: input.status,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      // null clears the scope (all categories); undefined leaves it unchanged.
      categoryId: input.categoryId === undefined ? undefined : input.categoryId ?? null,
    },
    include: campaignInclude,
  });
  return serialize(campaign);
}

// A campaign is "live" when it grants the discount to new registrations.
export function isLive(c: { status: string; startsAt: Date; endsAt: Date }, now = new Date()): boolean {
  return c.status === 'ACTIVE' && c.startsAt <= now && c.endsAt >= now;
}

// Public (unauthenticated): what the registration page shows for a scanned QR.
export async function getPublicCampaign(qrToken: string) {
  const c = await prisma.exhibitionCampaign.findUnique({
    where: { qrToken },
    include: { category: { select: { name: true, slug: true } } },
  });
  if (!c) throw AppError.notFound('Campaign not found');
  return serialize({
    name: c.name,
    discountPercent: c.discountPercent,
    live: isLive(c),
    category: c.category ? { name: c.category.name, slug: c.category.slug } : null,
  });
}
