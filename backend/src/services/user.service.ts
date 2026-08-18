import { Prisma, Role } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { hashPassword } from '../utils/password';
import { parsePagination, pageMeta } from '../utils/pagination';
import { notDeleted } from '../models/selectors';
import { serialize } from '../models/serializers';
import type {
  InviteUserInput,
  UpdateUserInput,
  ImportUsersInput,
  UserListQuery,
  UserTab,
  CreateCompanyInput,
  UpdateCompanyInput,
  AssignAdminInput,
  UpdateResellerInput,
} from '../validators/user.schema';

const D = (n: number) => new Prisma.Decimal(n);

// Provisioned operator accounts get a known demo password (surfaced in the UI).
const DEFAULT_ADMIN_PASSWORD = 'imcorp@2026';

// ─── Unified list across the four org "tabs" ─────────────────────────────────

export async function listUsers(query: UserListQuery) {
  const p = parsePagination(query);
  const q = query.q?.trim();

  switch (query.type) {
    case 'companies': {
      const where: Prisma.CompanyWhereInput = {
        ...notDeleted,
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
      };
      const [rows, total] = await prisma.$transaction([
        prisma.company.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: p.skip,
          take: p.take,
          include: {
            adminUser: { select: { fullName: true, email: true } },
            _count: { select: { employees: true } },
          },
        }),
        prisma.company.count({ where }),
      ]);
      const data = rows.map((c) => ({
        id: c.id,
        userId: c.adminUserId, // the backing admin user (null if none assigned yet)
        name: c.name,
        gstin: c.gstin,
        status: c.status,
        smartEppEnabled: c.smartEppEnabled,
        adminName: c.adminUser?.fullName ?? null,
        adminEmail: c.adminUser?.email ?? null,
        employeeCount: c._count.employees,
        createdAt: c.createdAt,
      }));
      return { data: serialize(data), meta: pageMeta(total, p) };
    }

    case 'employees': {
      const where: Prisma.EmployeeWhereInput = {
        ...notDeleted,
        ...(q
          ? {
              OR: [
                { employeeCode: { contains: q, mode: 'insensitive' } },
                { user: { fullName: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };
      const [rows, total] = await prisma.$transaction([
        prisma.employee.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: p.skip,
          take: p.take,
          include: {
            user: { select: { id: true, fullName: true, email: true, status: true } },
            company: { select: { id: true, name: true } },
          },
        }),
        prisma.employee.count({ where }),
      ]);
      const data = rows.map((e) => ({
        id: e.id,
        userId: e.user.id,
        name: e.user.fullName,
        email: e.user.email,
        employeeCode: e.employeeCode,
        department: e.department,
        program: e.program,
        company: e.company.name,
        status: e.user.status,
        createdAt: e.createdAt,
      }));
      return { data: serialize(data), meta: pageMeta(total, p) };
    }

    case 'resellers':
    case 'partners': {
      const isReseller = query.type === 'resellers';
      const where = q ? { name: { contains: q, mode: 'insensitive' as const } } : {};
      if (isReseller) {
        const [rows, total] = await prisma.$transaction([
          prisma.reseller.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: p.skip,
            take: p.take,
            include: { _count: { select: { products: true, orders: true } } },
          }),
          prisma.reseller.count({ where }),
        ]);
        const data = rows.map((r) => ({
          id: r.id,
          userId: r.userId,
          name: r.name,
          gstin: r.gstin,
          pan: r.pan,
          contactEmail: r.contactEmail,
          contactPhone: r.contactPhone,
          addressLine1: r.addressLine1,
          addressLine2: r.addressLine2,
          city: r.city,
          state: r.state,
          pincode: r.pincode,
          commissionPct: r.commissionPct,
          status: r.status,
          productCount: r._count.products,
          orderCount: r._count.orders,
          createdAt: r.createdAt,
        }));
        return { data: serialize(data), meta: pageMeta(total, p) };
      }
      const [rows, total] = await prisma.$transaction([
        prisma.fulfillmentPartner.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: p.skip,
          take: p.take,
          include: { _count: { select: { shipments: true } } },
        }),
        prisma.fulfillmentPartner.count({ where }),
      ]);
      const data = rows.map((f) => ({
        id: f.id,
        userId: f.userId,
        name: f.name,
        gstin: f.gstin,
        contactEmail: f.contactEmail,
        contactPhone: f.contactPhone,
        status: f.status,
        shipmentCount: f._count.shipments,
        createdAt: f.createdAt,
      }));
      return { data: serialize(data), meta: pageMeta(total, p) };
    }

    default:
      throw AppError.badRequest('Unknown user type');
  }
}

// ─── Invite / create ─────────────────────────────────────────────────────────

const ROLE_FOR_TAB: Record<UserTab, Role> = {
  companies: Role.COMPANY_ADMIN,
  employees: Role.EMPLOYEE_EPP,
  resellers: Role.RESELLER,
  partners: Role.FULFILLMENT_PARTNER,
};

export async function inviteUser(input: InviteUserInput) {
  const role = ROLE_FOR_TAB[input.type];

  return prisma.$transaction(async (tx) => {
    // Every org type is backed by a User account (status INVITED until first login).
    const user = await tx.user.create({
      data: {
        email: input.email.toLowerCase(),
        phone: input.phone,
        fullName: input.name,
        role,
        status: 'INVITED',
      },
    });

    switch (input.type) {
      case 'companies': {
        const company = await tx.company.create({
          data: { name: input.name, gstin: input.gstin ?? null, adminUserId: user.id, status: 'ONBOARDING' },
        });
        return serialize({ id: company.id, type: input.type, name: company.name, userId: user.id, email: user.email });
      }
      case 'employees': {
        if (!input.companyId) throw AppError.badRequest('companyId is required for an employee');
        const employee = await tx.employee.create({
          data: {
            companyId: input.companyId,
            userId: user.id,
            employeeCode: input.employeeCode ?? `EMP-${Date.now()}`,
            department: input.department,
            monthlySalary: D(input.monthlySalary ?? 0),
          },
        });
        return serialize({ id: employee.id, type: input.type, name: input.name, userId: user.id, email: user.email });
      }
      case 'resellers': {
        const reseller = await tx.reseller.create({
          data: {
            name: input.name,
            gstin: input.gstin || null,
            pan: input.pan || null,
            contactEmail: input.email,
            contactPhone: input.phone || null,
            addressLine1: input.addressLine1 || null,
            addressLine2: input.addressLine2 || null,
            city: input.city || null,
            state: input.state || null,
            pincode: input.pincode || null,
            commissionPct: input.commissionPct ?? null,
            userId: user.id,
            status: 'ONBOARDING',
          },
        });
        return serialize({ id: reseller.id, type: input.type, name: reseller.name, userId: user.id, email: user.email });
      }
      case 'partners': {
        const partner = await tx.fulfillmentPartner.create({
          data: { name: input.name, gstin: input.gstin ?? null, contactEmail: input.email, userId: user.id, status: 'ONBOARDING' },
        });
        return serialize({ id: partner.id, type: input.type, name: partner.name, userId: user.id, email: user.email });
      }
    }
  });
}

// ─── Company + admin provisioning ────────────────────────────────────────────

// Create a company AND its company-admin operator in one step. The admin is
// ACTIVE with a (provided or default) password so they can sign into the
// company portal immediately. emailDomain defaults from the admin email so
// employees who self-register on that domain auto-join.
export async function createCompany(input: CreateCompanyInput) {
  const email = input.adminEmail.toLowerCase();
  const exists = await prisma.user.findFirst({ where: { email } });
  if (exists) throw AppError.conflict('An account with this admin email already exists');

  const domain = (input.emailDomain?.trim() || email.split('@')[1] || '').toLowerCase() || null;
  const passwordHash = await hashPassword(input.adminPassword ?? DEFAULT_ADMIN_PASSWORD);

  const { company, user } = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email,
        phone: input.adminPhone,
        passwordHash,
        fullName: input.adminName,
        role: Role.COMPANY_ADMIN,
        status: 'ACTIVE',
      },
    });
    const c = await tx.company.create({
      data: {
        name: input.companyName,
        gstin: input.gstin ?? null,
        emailDomain: domain,
        adminUserId: u.id,
        status: 'ACTIVE',
        smartEppEnabled: input.smartEppEnabled ?? false,
      },
    });
    return { company: c, user: u };
  });

  return serialize({
    id: company.id,
    type: 'companies',
    name: company.name,
    emailDomain: company.emailDomain,
    adminUserId: user.id,
    adminEmail: user.email,
    tempPassword: input.adminPassword ? undefined : DEFAULT_ADMIN_PASSWORD,
  });
}

// Super-Admin edits a company's org-level settings (currently the Smart-EPP
// enablement + name).
export async function updateCompany(id: string, input: UpdateCompanyInput) {
  const company = await prisma.company.findFirst({ where: { id, deletedAt: null } });
  if (!company) throw AppError.notFound('Company not found');
  const updated = await prisma.company.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.smartEppEnabled !== undefined ? { smartEppEnabled: input.smartEppEnabled } : {}),
    },
    select: { id: true, name: true, status: true, smartEppEnabled: true },
  });
  return serialize(updated);
}

// Grant company-admin rights to an org that has none. Either promote an existing
// user (e.g. a self-registered employee) or invite a fresh admin account.
export async function assignCompanyAdmin(companyId: string, input: AssignAdminInput) {
  const company = await prisma.company.findFirst({ where: { id: companyId, deletedAt: null } });
  if (!company) throw AppError.notFound('Company not found');

  let tempPassword: string | undefined;

  const updated = await prisma.$transaction(async (tx) => {
    let adminUserId: string;

    if (input.userId) {
      const user = await tx.user.findFirst({ where: { id: input.userId, deletedAt: null } });
      if (!user) throw AppError.notFound('User not found');
      await tx.user.update({
        where: { id: user.id },
        data: { role: Role.COMPANY_ADMIN, status: 'ACTIVE' },
      });
      adminUserId = user.id;
    } else {
      const email = input.adminEmail!.toLowerCase();
      const exists = await tx.user.findFirst({ where: { email } });
      if (exists) throw AppError.conflict('An account with this email already exists');
      tempPassword = input.adminPassword ?? DEFAULT_ADMIN_PASSWORD;
      const passwordHash = await hashPassword(tempPassword);
      const user = await tx.user.create({
        data: {
          email,
          phone: input.adminPhone,
          passwordHash,
          fullName: input.adminName!,
          role: Role.COMPANY_ADMIN,
          status: 'ACTIVE',
        },
      });
      adminUserId = user.id;
      if (input.adminPassword) tempPassword = undefined;
    }

    return tx.company.update({
      where: { id: company.id },
      data: { adminUserId, status: 'ACTIVE' },
      include: { adminUser: { select: { fullName: true, email: true } } },
    });
  });

  return serialize({
    id: updated.id,
    name: updated.name,
    status: updated.status,
    adminName: updated.adminUser?.fullName ?? null,
    adminEmail: updated.adminUser?.email ?? null,
    tempPassword,
  });
}

// ─── Update / deactivate ─────────────────────────────────────────────────────
// `id` here is the User id (the account behind the org record).

export async function updateUser(userId: string, input: UpdateUserInput) {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) throw AppError.notFound('User not found');

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { fullName: input.fullName, phone: input.phone, status: input.status },
    select: { id: true, fullName: true, email: true, phone: true, role: true, status: true },
  });
  return serialize(updated);
}

// Super Admin edits a reseller org row (business details + commission). `id` is
// the Reseller id.
export async function updateReseller(id: string, input: UpdateResellerInput) {
  const reseller = await prisma.reseller.findFirst({ where: { id } });
  if (!reseller) throw AppError.notFound('Reseller not found');

  const updated = await prisma.reseller.update({
    where: { id },
    data: {
      name: input.name,
      gstin: input.gstin === undefined ? undefined : input.gstin || null,
      pan: input.pan === undefined ? undefined : input.pan || null,
      contactPhone: input.contactPhone === undefined ? undefined : input.contactPhone || null,
      addressLine1: input.addressLine1 === undefined ? undefined : input.addressLine1 || null,
      addressLine2: input.addressLine2 === undefined ? undefined : input.addressLine2 || null,
      city: input.city === undefined ? undefined : input.city || null,
      state: input.state === undefined ? undefined : input.state || null,
      pincode: input.pincode === undefined ? undefined : input.pincode || null,
      commissionPct: input.commissionPct === undefined ? undefined : D(input.commissionPct),
      status: input.status,
    },
  });
  return serialize(updated);
}

export async function importUsers(input: ImportUsersInput) {
  const results = { created: 0, skipped: 0, errors: [] as { email: string; reason: string }[] };

  for (const row of input.rows) {
    try {
      const exists = await prisma.user.findFirst({ where: { email: row.email.toLowerCase() } });
      if (exists) {
        results.skipped += 1;
        continue;
      }
      await inviteUser({
        type: input.type,
        name: row.name,
        email: row.email,
        phone: row.phone,
        companyId: row.companyId,
        employeeCode: row.employeeCode,
        department: row.department,
        monthlySalary: row.monthlySalary,
      });
      results.created += 1;
    } catch (e) {
      results.errors.push({ email: row.email, reason: e instanceof Error ? e.message : 'unknown' });
    }
  }

  return results;
}
