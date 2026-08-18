import { z } from 'zod';

const campaignFields = {
  name: z.string().trim().min(1).max(120),
  discountPercent: z.number().min(0).max(100),
  discountMode: z.enum(['FIRST_ORDER', 'WHILE_ACTIVE', 'FOREVER']).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED']).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  // Category scope: a category id, or null/absent = all categories.
  categoryId: z.string().min(1).nullish(),
};

export const createCampaignBody = z
  .object(campaignFields)
  .refine((v) => v.endsAt > v.startsAt, { message: 'endsAt must be after startsAt', path: ['endsAt'] });

export const updateCampaignBody = z
  .object({
    name: campaignFields.name.optional(),
    discountPercent: campaignFields.discountPercent.optional(),
    discountMode: campaignFields.discountMode,
    status: campaignFields.status,
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    categoryId: campaignFields.categoryId,
  })
  .refine((v) => !(v.startsAt && v.endsAt) || v.endsAt > v.startsAt, {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });

export type CreateCampaignInput = z.infer<typeof createCampaignBody>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignBody>;
