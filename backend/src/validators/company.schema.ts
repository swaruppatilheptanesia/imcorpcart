import { z } from 'zod';

export const companyEmployeeListQuery = z.object({
  q: z.string().trim().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'INVITED', 'DISABLED']).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

// HR adds an employee under their own company. `creditLimit` is the employee's
// Smart-EPP purchase limit (the total pre-tax EMI they may commit — typically
// derived from salary); the ledger in credit.service tracks what's used.
export const createEmployeeBody = z.object({
  fullName: z.string().trim().min(1),
  email: z.string().email(),
  phone: z.string().trim().optional(),
  employeeCode: z.string().trim().optional(),
  department: z.string().trim().optional(),
  monthlySalary: z.number().nonnegative().optional(),
  creditLimit: z.number().nonnegative().optional(),
});

export const updateEmployeeBody = z.object({
  department: z.string().trim().optional(),
  monthlySalary: z.number().nonnegative().optional(),
  creditLimit: z.number().nonnegative().nullable().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});

export type CompanyEmployeeListQuery = z.infer<typeof companyEmployeeListQuery>;
export type CreateEmployeeInput = z.infer<typeof createEmployeeBody>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeBody>;
