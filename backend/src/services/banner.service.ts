import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { serialize } from '../models/serializers';
import type { CreateBannerInput, UpdateBannerInput } from '../validators/banner.schema';

const BANNER_ORDER = [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }];

// Super-Admin view: every banner, active or not.
export async function listBanners() {
  const rows = await prisma.promoBanner.findMany({ orderBy: BANNER_ORDER });
  return { data: serialize(rows) };
}

// Storefront view: only active banners, in display order.
export async function listActiveBanners() {
  const rows = await prisma.promoBanner.findMany({
    where: { isActive: true },
    orderBy: BANNER_ORDER,
    select: { id: true, title: true, imageUrl: true, linkUrl: true },
  });
  return { data: serialize(rows) };
}

export async function createBanner(input: CreateBannerInput) {
  const banner = await prisma.promoBanner.create({
    data: {
      title: input.title,
      imageUrl: input.imageUrl,
      linkUrl: input.linkUrl || null,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    },
  });
  return serialize(banner);
}

export async function updateBanner(id: string, input: UpdateBannerInput) {
  const existing = await prisma.promoBanner.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound('Banner not found');
  const banner = await prisma.promoBanner.update({
    where: { id },
    data: {
      title: input.title,
      imageUrl: input.imageUrl,
      linkUrl: input.linkUrl === undefined ? undefined : input.linkUrl || null,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
    },
  });
  return serialize(banner);
}

export async function deleteBanner(id: string) {
  const existing = await prisma.promoBanner.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound('Banner not found');
  await prisma.promoBanner.delete({ where: { id } });
  return { ok: true };
}
