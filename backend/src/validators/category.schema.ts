import { z } from 'zod';

// Category master (super admin). A subcategory is a category with a parentId.
export const createCategoryBody = z.object({
  name: z.string().trim().min(1).max(80),
  parentId: z.string().min(1).optional(), // set → creates a subcategory under this parent
  isActive: z.boolean().optional(),
});

// Rename / (de)activate only — slug stays stable (storefront filters depend on it).
export const updateCategoryBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  isActive: z.boolean().optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategoryBody>;
export type UpdateCategoryInput = z.infer<typeof updateCategoryBody>;
