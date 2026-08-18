import { z } from 'zod';

const bannerFields = {
  title: z.string().trim().min(1).max(120),
  imageUrl: z.string().trim().min(1).max(500),
  linkUrl: z.string().trim().max(500).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
};

export const createBannerBody = z.object(bannerFields);

export const updateBannerBody = z.object({
  title: bannerFields.title.optional(),
  imageUrl: bannerFields.imageUrl.optional(),
  linkUrl: bannerFields.linkUrl,
  sortOrder: bannerFields.sortOrder,
  isActive: bannerFields.isActive,
});

export type CreateBannerInput = z.infer<typeof createBannerBody>;
export type UpdateBannerInput = z.infer<typeof updateBannerBody>;
