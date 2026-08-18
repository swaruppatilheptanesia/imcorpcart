import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { serialize } from '../models/serializers';
import { slugify } from '../utils/slug';
import type { CreateCategoryInput, UpdateCategoryInput } from '../validators/category.schema';

// Category/sub-category master. Top-level categories carry their children
// (subcategories = category rows with parentId set).
export async function listCategoryTree() {
  const rows = await prisma.category.findMany({
    where: { parentId: null },
    orderBy: { name: 'asc' },
    include: {
      children: {
        orderBy: { name: 'asc' },
        include: { _count: { select: { products: true } } },
      },
      _count: { select: { products: true, children: true } },
    },
  });
  return { data: serialize(rows) };
}

// Derive a unique slug from the name (append -2, -3… on collision).
async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || 'category';
  let slug = base;
  let n = 2;
  // eslint-disable-next-line no-await-in-loop
  while (await prisma.category.findUnique({ where: { slug } })) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

export async function createCategory(input: CreateCategoryInput) {
  if (input.parentId) {
    const parent = await prisma.category.findUnique({ where: { id: input.parentId } });
    if (!parent) throw AppError.badRequest('Parent category not found');
    if (parent.parentId) throw AppError.badRequest('Subcategories cannot be nested further');
  }
  const category = await prisma.category.create({
    data: {
      name: input.name,
      slug: await uniqueSlug(input.name),
      parentId: input.parentId ?? null,
      isActive: input.isActive ?? true,
    },
  });
  return serialize(category);
}

export async function updateCategory(id: string, input: UpdateCategoryInput) {
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound('Category not found');
  const category = await prisma.category.update({
    where: { id },
    data: { name: input.name, isActive: input.isActive },
  });
  return serialize(category);
}

export async function deleteCategory(id: string) {
  const category = await prisma.category.findUnique({
    where: { id },
    include: { _count: { select: { products: true, children: true } } },
  });
  if (!category) throw AppError.notFound('Category not found');
  if (category._count.products > 0 || category._count.children > 0) {
    throw AppError.conflict('Category is in use — deactivate it instead of deleting');
  }
  await prisma.category.delete({ where: { id } });
  return { ok: true };
}
