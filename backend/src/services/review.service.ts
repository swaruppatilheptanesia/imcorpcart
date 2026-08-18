import { Prisma, ReviewStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { serialize } from '../models/serializers';
import { resolveEmployee } from '../utils/scope';
import { parsePagination, pageMeta } from '../utils/pagination';
import type { ReviewInput, ReviewListQuery, ReviewStatusInput } from '../validators/review.schema';

// Recompute a product's denormalized rating/reviewCount from its APPROVED
// reviews. Runs inside the caller's transaction so the aggregate can never
// drift from the moderation decision. No approved reviews → rating cleared.
async function recomputeProductRating(tx: Prisma.TransactionClient, productId: string) {
  const agg = await tx.productReview.aggregate({
    where: { productId, status: ReviewStatus.APPROVED },
    _avg: { rating: true },
    _count: { _all: true },
  });
  const count = agg._count._all;
  await tx.product.update({
    where: { id: productId },
    data: {
      rating: count > 0 ? Number((agg._avg.rating ?? 0).toFixed(2)) : null,
      reviewCount: count,
    },
  });
}

// Employee submits (or overwrites) their single review for a product. Any edit
// resets it to PENDING so a changed review is re-verified before it shows.
export async function submitReview(userId: string, productId: string, input: ReviewInput) {
  const { id: employeeId } = await resolveEmployee(userId);
  const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
  if (!product) throw AppError.notFound('Product not found');

  const review = await prisma.$transaction(async (tx) => {
    const r = await tx.productReview.upsert({
      where: { employeeId_productId: { employeeId, productId } },
      create: { employeeId, productId, rating: input.rating, title: input.title, body: input.body },
      update: {
        rating: input.rating,
        title: input.title ?? null,
        body: input.body,
        status: ReviewStatus.PENDING,
      },
    });
    // An edit of a previously-approved review must drop out of the aggregate
    // until it's re-approved.
    await recomputeProductRating(tx, productId);
    return r;
  });

  return serialize(review);
}

// Approved reviews for a product's detail page (public + authed). Author is the
// reviewer's display name only — no email/PII.
export async function listApprovedReviews(productId: string) {
  const rows = await prisma.productReview.findMany({
    where: { productId, status: ReviewStatus.APPROVED },
    orderBy: { updatedAt: 'desc' },
    include: { employee: { select: { user: { select: { fullName: true } } } } },
  });
  return rows.map((r) => ({
    id: r.id,
    author: r.employee.user.fullName,
    rating: r.rating,
    title: r.title,
    body: r.body,
    createdAt: r.createdAt,
  }));
}

// ─── Super Admin moderation ──────────────────────────────────────────────────

export async function listReviews(query: ReviewListQuery) {
  const p = parsePagination(query);
  const where: Prisma.ProductReviewWhereInput = {};
  if (query.status) where.status = query.status;

  const [rows, total] = await prisma.$transaction([
    prisma.productReview.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: p.skip,
      take: p.take,
      include: {
        employee: { select: { user: { select: { fullName: true, email: true } } } },
        product: { select: { name: true, sku: true } },
      },
    }),
    prisma.productReview.count({ where }),
  ]);

  const data = rows.map((r) => ({
    id: r.id,
    author: r.employee.user.fullName,
    authorEmail: r.employee.user.email,
    productId: r.productId,
    productName: r.product.name,
    productSku: r.product.sku,
    rating: r.rating,
    title: r.title,
    body: r.body,
    status: r.status,
    createdAt: r.createdAt,
  }));

  return { data: serialize(data), meta: pageMeta(total, p) };
}

export async function setReviewStatus(id: string, input: ReviewStatusInput) {
  const review = await prisma.productReview.findUnique({ where: { id } });
  if (!review) throw AppError.notFound('Review not found');
  if (review.status === input.status) throw AppError.badRequest(`Review is already ${input.status}`);

  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.productReview.update({
      where: { id },
      data: { status: input.status as ReviewStatus },
    });
    await recomputeProductRating(tx, review.productId);
    return r;
  });

  return serialize(updated);
}
