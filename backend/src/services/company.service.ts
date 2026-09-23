import { Prisma, Role, OrderStatus, SmartEppStatus, ApprovalStage, ApprovalStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { hashPassword } from '../utils/password';
import { parsePagination, pageMeta } from '../utils/pagination';
import { notDeleted, orderListSelect } from '../models/selectors';
import { serialize, toNumber } from '../models/serializers';
import { resolveCompanyId } from '../utils/scope';
import { ensureCreditAccount, releaseCredit, replenishCredit } from './credit.service';
import { seppRequestInclude, toSeppRequestView, reservedAmountOf, refundAdvance } from './sepp.service';
import { notifySepp } from './sepp-notify';
import type { SeppQuote } from './sepp-calc';
import type {
  CompanyEmployeeListQuery,
  CreateEmployeeInput,
  UpdateEmployeeInput,
} from '../validators/company.schema';
import type {
  SeppRequestListQuery,
  SeppDecisionInput,
  CompanyAddressInput,
  UpdateCompanyAddressInput,
} from '../validators/sepp.schema';

const D = (n: number) => new Prisma.Decimal(n);

// New employees provisioned by HR get a known demo password so they can sign in
// immediately (surfaced in the UI). Production would email a set-password link.
const DEFAULT_EMPLOYEE_PASSWORD = 'imcorp@2026';

const REALISED: OrderStatus[] = [
  OrderStatus.PLACED,
  OrderStatus.CONFIRMED,
  OrderStatus.DISPATCHED,
  OrderStatus.DELIVERED,
];

// ─── Profile ─────────────────────────────────────────────────────────────────

export async function getProfile(userId: string) {
  const companyId = await resolveCompanyId(userId);
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: {
      adminUser: { select: { fullName: true, email: true } },
      _count: { select: { employees: true } },
    },
  });
  if (!company) throw AppError.notFound('Company not found');
  return serialize({
    id: company.id,
    name: company.name,
    gstin: company.gstin,
    emailDomain: company.emailDomain,
    status: company.status,
    adminName: company.adminUser?.fullName ?? null,
    adminEmail: company.adminUser?.email ?? null,
    employeeCount: company._count.employees,
    createdAt: company.createdAt,
  });
}

// ─── Dashboard (EPP focus) ───────────────────────────────────────────────────

export async function getDashboard(userId: string) {
  const companyId = await resolveCompanyId(userId);
  const orderWhere = { companyId, status: { in: REALISED } };

  const [employeeCount, activeEmployees, agg, orderCount, recentOrders, topEmployeesRaw, seppPending, seppActive, seppDue] =
    await Promise.all([
      prisma.employee.count({ where: { companyId, ...notDeleted } }),
      prisma.employee.count({ where: { companyId, ...notDeleted, user: { status: 'ACTIVE' } } }),
      prisma.order.aggregate({ where: orderWhere, _sum: { total: true } }),
      prisma.order.count({ where: orderWhere }),
      prisma.order.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          orderNo: true,
          status: true,
          total: true,
          createdAt: true,
          employee: { select: { user: { select: { fullName: true } } } },
          items: { take: 1, select: { product: { select: { name: true } } } },
        },
      }),
      prisma.order.groupBy({
        by: ['employeeId'],
        where: orderWhere,
        _sum: { total: true },
        _count: { _all: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 5,
      }),
      // Smart EPP: awaiting HR, active leases, and installments due up to today
      // that HR hasn't recorded as paid yet.
      prisma.smartEppRequest.count({ where: { companyId, status: SmartEppStatus.SUBMITTED } }),
      prisma.smartEppRequest.count({ where: { companyId, status: { in: [SmartEppStatus.APPROVED, SmartEppStatus.ORDERED] } } }),
      prisma.leaseScheduleInstallment.count({
        where: { paidAt: null, dueDate: { lte: new Date() }, leaseTerms: { request: { companyId } } },
      }),
    ]);

  const topEmployees = await prisma.employee.findMany({
    where: { id: { in: topEmployeesRaw.map((t) => t.employeeId).filter((id): id is string => id !== null) } },
    select: { id: true, user: { select: { fullName: true } } },
  });
  const nameOf = (id: string) =>
    topEmployees.find((e) => e.id === id)?.user.fullName ?? 'Unknown';

  const spend = toNumber(agg._sum.total);
  return serialize({
    stats: {
      employees: employeeCount,
      activeEmployees,
      orders: orderCount,
      orderValue: spend,
      avgOrderValue: orderCount ? Math.round((spend / orderCount) * 100) / 100 : 0,
      seppPending,
      seppActive,
      seppInstallmentsDue: seppDue,
    },
    recentOrders: recentOrders.map((o) => ({
      id: o.orderNo,
      buyer: o.employee?.user.fullName ?? '—',
      product: o.items[0]?.product.name ?? '—',
      value: toNumber(o.total),
      status: o.status,
      date: o.createdAt,
    })),
    topEmployees: topEmployeesRaw.map((t) => ({
      employeeId: t.employeeId,
      name: t.employeeId ? nameOf(t.employeeId) : 'Unknown',
      spend: toNumber(t._sum.total),
      orders: t._count._all,
    })),
  });
}

// ─── Employees ───────────────────────────────────────────────────────────────

export async function listEmployees(userId: string, query: CompanyEmployeeListQuery) {
  const companyId = await resolveCompanyId(userId);
  const p = parsePagination(query);
  const q = query.q?.trim();

  const where: Prisma.EmployeeWhereInput = {
    companyId,
    ...notDeleted,
    ...(query.status ? { user: { status: query.status } } : {}),
    ...(q
      ? {
          OR: [
            { employeeCode: { contains: q, mode: 'insensitive' } },
            { user: { fullName: { contains: q, mode: 'insensitive' } } },
            { user: { email: { contains: q, mode: 'insensitive' } } },
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
        user: { select: { id: true, fullName: true, email: true, phone: true, status: true } },
        creditAccount: { select: { creditLimit: true, availableCredit: true, reservedCredit: true } },
        _count: { select: { orders: true, smartEppRequests: true } },
      },
    }),
    prisma.employee.count({ where }),
  ]);

  const data = rows.map((e) => {
    const limit = e.creditLimit === null ? null : toNumber(e.creditLimit);
    // Ledger-backed availability; before the first request the whole limit is free.
    const available = e.creditAccount ? Math.max(0, toNumber(e.creditAccount.availableCredit)) : limit;
    return {
      id: e.id,
      userId: e.user.id,
      name: e.user.fullName,
      email: e.user.email,
      phone: e.user.phone,
      employeeCode: e.employeeCode,
      department: e.department,
      program: e.program,
      monthlySalary: toNumber(e.monthlySalary),
      creditLimit: limit,
      creditAvailable: available,
      creditReserved: e.creditAccount ? toNumber(e.creditAccount.reservedCredit) : 0,
      seppRequestCount: e._count.smartEppRequests,
      status: e.user.status,
      orderCount: e._count.orders,
      createdAt: e.createdAt,
    };
  });
  return { data: serialize(data), meta: pageMeta(total, p) };
}

export async function createEmployee(userId: string, input: CreateEmployeeInput) {
  const companyId = await resolveCompanyId(userId);

  const email = input.email.toLowerCase();
  const exists = await prisma.user.findFirst({ where: { email } });
  if (exists) throw AppError.conflict('An account with this email already exists');

  const passwordHash = await hashPassword(DEFAULT_EMPLOYEE_PASSWORD);

  const employee = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        phone: input.phone,
        passwordHash,
        fullName: input.fullName,
        role: Role.EMPLOYEE_EPP,
        status: 'ACTIVE',
      },
    });
    return tx.employee.create({
      data: {
        companyId,
        userId: user.id,
        employeeCode: input.employeeCode?.trim() || `EMP-${Date.now()}`,
        department: input.department,
        monthlySalary: D(input.monthlySalary ?? 0),
        creditLimit: input.creditLimit === undefined ? null : D(input.creditLimit),
      },
      include: { user: { select: { id: true, fullName: true, email: true, status: true } } },
    });
  });

  return serialize({
    id: employee.id,
    userId: employee.user.id,
    name: employee.user.fullName,
    email: employee.user.email,
    employeeCode: employee.employeeCode,
    department: employee.department,
    creditLimit: employee.creditLimit === null ? null : toNumber(employee.creditLimit),
    status: employee.user.status,
    tempPassword: DEFAULT_EMPLOYEE_PASSWORD,
  });
}

// ─── Orders (the company's EPP orders) ───────────────────────────────────────

export async function listOrders(userId: string, bucket?: string) {
  const companyId = await resolveCompanyId(userId);
  const BUCKETS: Record<string, OrderStatus[]> = {
    active: [OrderStatus.PLACED, OrderStatus.CONFIRMED, OrderStatus.DISPATCHED],
    delivered: [OrderStatus.DELIVERED],
    cancelled: [OrderStatus.CANCELLED, OrderStatus.RETURNED],
  };
  const where: Prisma.OrderWhereInput = { companyId };
  if (bucket && bucket !== 'all') where.status = { in: BUCKETS[bucket] };

  const rows = await prisma.order.findMany({
    where,
    select: orderListSelect,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return { data: serialize(rows) };
}

export async function updateEmployee(
  userId: string,
  employeeId: string,
  input: UpdateEmployeeInput,
) {
  const companyId = await resolveCompanyId(userId);
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId, ...notDeleted },
    select: { id: true, userId: true, user: { select: { status: true } } },
  });
  if (!employee) throw AppError.notFound('Employee not found');

  // Self-registered employees await Super Admin approval — the Company/HR portal
  // cannot activate or otherwise change their status.
  if (input.status && employee.user.status === 'PENDING') {
    throw AppError.forbidden(
      'This account is pending Super Admin approval and can only be activated by a Super Admin.',
    );
  }

  const empData: Prisma.EmployeeUpdateInput = {};
  if (input.department !== undefined) empData.department = input.department;
  if (input.monthlySalary !== undefined) empData.monthlySalary = D(input.monthlySalary);
  if (input.creditLimit !== undefined) {
    empData.creditLimit = input.creditLimit === null ? null : D(input.creditLimit);
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(empData).length) {
      await tx.employee.update({ where: { id: employee.id }, data: empData });
    }
    // Keep the Smart-EPP ledger's cached limit in step with the HR-set value.
    if (input.creditLimit !== undefined) await ensureCreditAccount(tx, employee.id);
    if (input.status) {
      await tx.user.update({ where: { id: employee.userId }, data: { status: input.status } });
    }
  });

  const updated = await prisma.employee.findUnique({
    where: { id: employee.id },
    include: { user: { select: { id: true, fullName: true, email: true, status: true } } },
  });
  return serialize({
    id: updated!.id,
    userId: updated!.user.id,
    name: updated!.user.fullName,
    email: updated!.user.email,
    department: updated!.department,
    monthlySalary: toNumber(updated!.monthlySalary),
    creditLimit: updated!.creditLimit === null ? null : toNumber(updated!.creditLimit),
    status: updated!.user.status,
  });
}

// ─── Smart EPP requests (HR stage-1 approval) ────────────────────────────────

export async function listSeppRequests(userId: string, query: SeppRequestListQuery) {
  const companyId = await resolveCompanyId(userId);
  const where: Prisma.SmartEppRequestWhereInput = { companyId, status: { not: SmartEppStatus.DRAFT } };
  switch (query.status) {
    case 'PENDING':
      where.status = SmartEppStatus.SUBMITTED; // awaiting HR
      break;
    case 'APPROVED':
      where.status = { in: [SmartEppStatus.HR_APPROVED, SmartEppStatus.LEASING_APPROVED, SmartEppStatus.APPROVED, SmartEppStatus.ORDERED] };
      break;
    case 'REJECTED':
      where.status = { in: [SmartEppStatus.REJECTED, SmartEppStatus.CANCELLED] };
      break;
  }
  const rows = await prisma.smartEppRequest.findMany({
    where,
    include: seppRequestInclude,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return { data: serialize(rows.map(toSeppRequestView)) };
}

export async function getSeppRequest(userId: string, id: string) {
  const companyId = await resolveCompanyId(userId);
  const r = await prisma.smartEppRequest.findFirst({ where: { id, companyId }, include: seppRequestInclude });
  if (!r) throw AppError.notFound('Request not found');
  return serialize(toSeppRequestView(r));
}

// HR approves (→ HR_APPROVED, on to the leasing company) or rejects (→ REJECTED:
// the reserved limit is released and any advance refunded). Unanimous rule: a
// rejection at any stage ends the request.
export async function decideSeppRequest(userId: string, id: string, input: SeppDecisionInput) {
  const companyId = await resolveCompanyId(userId);
  const r = await prisma.smartEppRequest.findFirst({ where: { id, companyId }, include: { approvals: true } });
  if (!r) throw AppError.notFound('Request not found');
  if (r.status !== SmartEppStatus.SUBMITTED) {
    throw AppError.badRequest('This request is no longer awaiting HR approval');
  }
  const step = r.approvals.find((a) => a.stage === ApprovalStage.HR);
  if (!step || step.status !== ApprovalStatus.PENDING) throw AppError.badRequest('HR approval has already been recorded');

  const approved = input.decision === 'APPROVED';
  await prisma.$transaction(async (tx) => {
    await tx.approvalStep.update({
      where: { id: step.id },
      data: { status: approved ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED, approverUserId: userId, comments: input.comments ?? null, decidedAt: new Date() },
    });
    await tx.smartEppRequest.update({
      where: { id: r.id },
      data: approved
        ? { status: SmartEppStatus.HR_APPROVED }
        : { status: SmartEppStatus.REJECTED, decidedAt: new Date() },
    });
    if (!approved) {
      await releaseCredit(tx, r.employeeId, reservedAmountOf(r), {
        referenceType: 'SMART_EPP_REQUEST',
        referenceId: r.id,
        note: `Released — request ${r.requestNo} rejected by HR`,
      });
    }
  });
  if (!approved) await refundAdvance(r.id);
  void notifySepp(r.id, approved ? 'HR_APPROVED' : 'REJECTED');
  return getSeppRequest(userId, r.id);
}

// HR records that a month's EMI was deducted via payroll → that installment's
// pre-tax slice of the purchase limit becomes available again (REPLENISH).
// Idempotent per installment: a second call is refused, never double-credited.
export async function markInstallmentPaid(userId: string, id: string, installmentNo: number) {
  const companyId = await resolveCompanyId(userId);
  const r = await prisma.smartEppRequest.findFirst({
    where: { id, companyId },
    include: { leaseTerms: { include: { installments: { orderBy: { installmentNo: 'asc' } } } } },
  });
  if (!r) throw AppError.notFound('Request not found');
  if (!r.leaseTerms || (r.status !== SmartEppStatus.ORDERED && r.status !== SmartEppStatus.APPROVED)) {
    throw AppError.badRequest('This request has no active lease yet');
  }
  const inst = r.leaseTerms.installments.find((i) => i.installmentNo === installmentNo);
  if (!inst) throw AppError.notFound('Installment not found');
  if (inst.paidAt) throw AppError.badRequest(`Installment #${installmentNo} is already recorded as paid`);

  // The limit was reserved as preTaxDeduction × tenure, so each paid month
  // restores exactly one preTaxDeduction (fallback: an equal share of the hold).
  const q = r.quote as SeppQuote | null;
  const perMonth = q?.preTaxDeduction ?? Math.round(reservedAmountOf(r) / r.leaseTerms.tenureMonths);

  await prisma.$transaction(async (tx) => {
    await tx.leaseScheduleInstallment.update({
      where: { id: inst.id },
      data: { paidAt: new Date(), paidById: userId },
    });
    await replenishCredit(tx, r.employeeId, perMonth, {
      referenceType: 'SMART_EPP_INSTALLMENT',
      referenceId: inst.id,
      note: `EMI #${installmentNo} of ${r.leaseTerms!.tenureMonths} paid — request ${r.requestNo}`,
    });
  });
  void notifySepp(r.id, 'INSTALLMENT_PAID', { installmentNo, restored: perMonth });
  return getSeppRequest(userId, r.id);
}

// ─── Office branches (Smart-EPP delivery addresses, company-owned) ──────────

function toBranch(a: Prisma.AddressGetPayload<object>) {
  return {
    id: a.id,
    label: a.label,
    contactName: a.contactName,
    contactPhone: a.contactPhone,
    line1: a.line1,
    line2: a.line2,
    city: a.city,
    state: a.state,
    pincode: a.pincode,
    isDefault: a.isDefault,
    createdAt: a.createdAt,
  };
}

export async function listCompanyAddresses(userId: string) {
  const companyId = await resolveCompanyId(userId);
  const rows = await prisma.address.findMany({
    where: { companyId, employeeId: null },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  return { data: serialize(rows.map(toBranch)) };
}

export async function createCompanyAddress(userId: string, input: CompanyAddressInput) {
  const companyId = await resolveCompanyId(userId);
  const count = await prisma.address.count({ where: { companyId, employeeId: null } });
  const isDefault = Boolean(input.isDefault) || count === 0; // first branch is the default
  if (isDefault) {
    await prisma.address.updateMany({ where: { companyId, employeeId: null, isDefault: true }, data: { isDefault: false } });
  }
  const created = await prisma.address.create({
    data: {
      companyId,
      type: 'OFFICE',
      label: input.label,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
      line1: input.line1,
      line2: input.line2 ?? null,
      city: input.city,
      state: input.state,
      pincode: input.pincode,
      isDefault,
    },
  });
  return serialize(toBranch(created));
}

export async function updateCompanyAddress(userId: string, id: string, input: UpdateCompanyAddressInput) {
  const companyId = await resolveCompanyId(userId);
  const existing = await prisma.address.findFirst({ where: { id, companyId, employeeId: null } });
  if (!existing) throw AppError.notFound('Address not found');
  const isDefault = input.isDefault ?? existing.isDefault;
  if (isDefault && !existing.isDefault) {
    await prisma.address.updateMany({ where: { companyId, employeeId: null, isDefault: true }, data: { isDefault: false } });
  }
  const updated = await prisma.address.update({
    where: { id },
    data: {
      label: input.label ?? existing.label,
      contactName: input.contactName ?? existing.contactName,
      contactPhone: input.contactPhone ?? existing.contactPhone,
      line1: input.line1 ?? existing.line1,
      line2: input.line2 !== undefined ? input.line2 : existing.line2,
      city: input.city ?? existing.city,
      state: input.state ?? existing.state,
      pincode: input.pincode ?? existing.pincode,
      isDefault,
    },
  });
  return serialize(toBranch(updated));
}

export async function deleteCompanyAddress(userId: string, id: string) {
  const companyId = await resolveCompanyId(userId);
  const existing = await prisma.address.findFirst({ where: { id, companyId, employeeId: null } });
  if (!existing) throw AppError.notFound('Address not found');
  const [orders, requests] = await Promise.all([
    prisma.order.count({ where: { addressId: id } }),
    prisma.smartEppRequest.count({ where: { addressId: id } }),
  ]);
  if (orders > 0 || requests > 0) {
    throw AppError.badRequest("This branch is used by an order or request and can't be deleted");
  }
  await prisma.address.delete({ where: { id } });
  return { ok: true };
}
