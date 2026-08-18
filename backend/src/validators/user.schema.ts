import { z } from 'zod';

export const USER_TABS = ['companies', 'employees', 'resellers', 'partners'] as const;
export type UserTab = (typeof USER_TABS)[number];

export const userListQuery = z.object({
  type: z.enum(USER_TABS).default('companies'),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

// Invite a new operator/company. Shape varies by tab; kept permissive and
// validated further in the service.
export const inviteUserBody = z.object({
  type: z.enum(USER_TABS),
  name: z.string().trim().min(1),
  email: z.string().email(),
  phone: z.string().trim().optional(),
  // company + reseller
  gstin: z.string().trim().max(20).optional(),
  // reseller-specific (PAN + registered address)
  pan: z
    .string()
    .trim()
    .max(10)
    .optional()
    .refine((v) => !v || /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/.test(v), {
      message: 'PAN must look like AAAAA9999A',
    }),
  addressLine1: z.string().trim().max(200).optional(),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  pincode: z.string().trim().max(12).optional(),
  commissionPct: z.number().min(0).max(100).optional(),
  // employee-specific
  companyId: z.string().min(1).optional(),
  employeeCode: z.string().trim().optional(),
  department: z.string().trim().optional(),
  monthlySalary: z.number().nonnegative().optional(),
});

export const updateUserBody = z.object({
  fullName: z.string().trim().min(1).optional(),
  phone: z.string().trim().optional(),
  status: z.enum(['ACTIVE', 'PENDING', 'SUSPENDED', 'DISABLED', 'INVITED']).optional(),
});

const panField = z
  .string()
  .trim()
  .max(10)
  .refine((v) => !v || /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/.test(v), { message: 'PAN must look like AAAAA9999A' });

// Super Admin edits a reseller's business details / commission (the org row).
export const updateResellerBody = z.object({
  name: z.string().trim().min(1).optional(),
  gstin: z.string().trim().max(20).optional(),
  pan: panField.optional(),
  contactPhone: z.string().trim().max(20).optional(),
  addressLine1: z.string().trim().max(200).optional(),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  pincode: z.string().trim().max(12).optional(),
  commissionPct: z.number().min(0).max(100).optional(),
  status: z.enum(['ACTIVE', 'ONBOARDING', 'SUSPENDED']).optional(),
});

export const companyIdParam = z.object({ companyId: z.string().min(1) });

// Super Admin creates a company AND provisions its company-admin operator so the
// admin can access the company portal. emailDomain defaults from the admin email.
export const createCompanyBody = z.object({
  companyName: z.string().trim().min(1),
  gstin: z.string().trim().optional(),
  emailDomain: z.string().trim().optional(),
  adminName: z.string().trim().min(1),
  adminEmail: z.string().email(),
  adminPhone: z.string().trim().optional(),
  adminPassword: z.string().min(6).optional(),
  smartEppEnabled: z.boolean().optional(),
});

// Super Admin edits a company's org-level settings (Smart-EPP enablement + name).
export const updateCompanyBody = z.object({
  name: z.string().trim().min(1).optional(),
  smartEppEnabled: z.boolean().optional(),
});

// Assign an admin to a company that has none (e.g. a self-registration-created
// org). Either promote an existing user (userId) or invite a new admin.
export const assignAdminBody = z
  .object({
    userId: z.string().min(1).optional(),
    adminName: z.string().trim().min(1).optional(),
    adminEmail: z.string().email().optional(),
    adminPhone: z.string().trim().optional(),
    adminPassword: z.string().min(6).optional(),
  })
  .refine((v) => Boolean(v.userId) || (Boolean(v.adminName) && Boolean(v.adminEmail)), {
    message: 'Provide either userId or both adminName and adminEmail',
  });

export const importUsersBody = z.object({
  type: z.enum(USER_TABS),
  rows: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        email: z.string().email(),
        phone: z.string().trim().optional(),
        companyId: z.string().optional(),
        employeeCode: z.string().optional(),
        department: z.string().optional(),
        monthlySalary: z.number().optional(),
      }),
    )
    .min(1),
});

export type InviteUserInput = z.infer<typeof inviteUserBody>;
export type UpdateUserInput = z.infer<typeof updateUserBody>;
export type UpdateResellerInput = z.infer<typeof updateResellerBody>;
export type ImportUsersInput = z.infer<typeof importUsersBody>;
export type UserListQuery = z.infer<typeof userListQuery>;
export type CreateCompanyInput = z.infer<typeof createCompanyBody>;
export type UpdateCompanyInput = z.infer<typeof updateCompanyBody>;
export type AssignAdminInput = z.infer<typeof assignAdminBody>;
