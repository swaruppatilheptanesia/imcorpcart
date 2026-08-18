import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { parsePagination, pageMeta } from '../utils/pagination';
import { couponInclude } from '../models/selectors';
import { serialize } from '../models/serializers';
import type {
  CreateCouponInput,
  UpdateCouponInput,
  CouponListQuery,
} from '../validators/coupon.schema';

const D = (n: number) => new Prisma.Decimal(n);

export async function listCoupons(query: CouponListQuery) {
  const p = parsePagination(query);
  const where: Prisma.CouponWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.q
      ? {
          OR: [
            { code: { contains: query.q, mode: 'insensitive' } },
            { category: { name: { contains: query.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.coupon.findMany({
      where,
      include: couponInclude,
      orderBy: { createdAt: 'desc' },
      skip: p.skip,
      take: p.take,
    }),
    prisma.coupon.count({ where }),
  ]);

  return { data: serialize(rows), meta: pageMeta(total, p) };
}

// Header stats used by the Coupons screen.
export async function couponStats() {
  const [active, scheduled, expired, redemptions] = await prisma.$transaction([
    prisma.coupon.count({ where: { status: 'ACTIVE' } }),
    prisma.coupon.count({ where: { status: 'SCHEDULED' } }),
    prisma.coupon.count({ where: { status: 'EXPIRED' } }),
    prisma.coupon.aggregate({ _sum: { usedCount: true } }),
  ]);
  return {
    active,
    scheduled,
    expired,
    totalRedemptions: redemptions._sum.usedCount ?? 0,
  };
}

export async function getCoupon(id: string) {
  const coupon = await prisma.coupon.findUnique({ where: { id }, include: couponInclude });
  if (!coupon) throw AppError.notFound('Coupon not found');
  return serialize(coupon);
}

export async function createCoupon(input: CreateCouponInput) {
  const coupon = await prisma.coupon.create({
    data: {
      code: input.code,
      type: input.type,
      value: D(input.value),
      maxDiscount: input.maxDiscount !== undefined ? D(input.maxDiscount) : null,
      minOrderValue: D(input.minOrderValue ?? 0),
      usageLimit: input.usageLimit,
      status: input.status ?? 'ACTIVE',
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      resellerId: input.resellerId ?? null,
      categoryId: input.categoryId ?? null,
    },
    include: couponInclude,
  });
  return serialize(coupon);
}

export async function updateCoupon(id: string, input: UpdateCouponInput) {
  const existing = await prisma.coupon.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound('Coupon not found');

  const coupon = await prisma.coupon.update({
    where: { id },
    data: {
      code: input.code,
      type: input.type,
      value: input.value !== undefined ? D(input.value) : undefined,
      maxDiscount: input.maxDiscount !== undefined ? D(input.maxDiscount) : undefined,
      minOrderValue: input.minOrderValue !== undefined ? D(input.minOrderValue) : undefined,
      usageLimit: input.usageLimit,
      status: input.status,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      resellerId: input.resellerId,
      categoryId: input.categoryId,
    },
    include: couponInclude,
  });
  return serialize(coupon);
}
