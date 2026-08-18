import { prisma } from '../config/prisma';
import { AppError } from './AppError';

// Resolve the org a role-scoped principal acts within, from their user id.
// Each returns the scope id (or throws 403 if the account isn't linked to one),
// so a Company Admin / Reseller / Employee can only ever touch their own data.

export async function resolveCompanyId(userId: string): Promise<string> {
  const company = await prisma.company.findFirst({
    where: { adminUserId: userId, deletedAt: null },
    select: { id: true },
  });
  if (!company) throw AppError.forbidden('No company is linked to this account');
  return company.id;
}

export async function resolveResellerId(userId: string): Promise<string> {
  const reseller = await prisma.reseller.findFirst({
    where: { userId },
    select: { id: true },
  });
  if (!reseller) throw AppError.forbidden('No reseller is linked to this account');
  return reseller.id;
}

export interface EmployeeScope {
  id: string;
  companyId: string;
}

export async function resolveEmployee(userId: string): Promise<EmployeeScope> {
  const employee = await prisma.employee.findFirst({
    where: { userId, deletedAt: null },
    select: { id: true, companyId: true },
  });
  if (!employee) throw AppError.forbidden('No employee profile is linked to this account');
  return employee;
}
