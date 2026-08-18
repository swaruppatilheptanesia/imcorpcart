import { Prisma, Role, OrderStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { hashPassword } from '../utils/password';
import { parsePagination, pageMeta } from '../utils/pagination';
import { notDeleted, orderListSelect } from '../models/selectors';
import { serialize, toNumber } from '../models/serializers';
import { resolveCompanyId } from '../utils/scope';
import type {
  CompanyEmployeeListQuery,
  CreateEmployeeInput,
  UpdateEmployeeInput,
} from '../validators/company.schema';

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

  const [employeeCount, activeEmployees, agg, orderCount, recentOrders, topEmployeesRaw] =
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
    ]);

  const topEmployees = await prisma.employee.findMany({
    where: { id: { in: topEmployeesRaw.map((t) => t.employeeId) } },
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
    },
    recentOrders: recentOrders.map((o) => ({
      id: o.orderNo,
      buyer: o.employee.user.fullName,
      product: o.items[0]?.product.name ?? '—',
      value: toNumber(o.total),
      status: o.status,
      date: o.createdAt,
    })),
    topEmployees: topEmployeesRaw.map((t) => ({
      employeeId: t.employeeId,
      name: nameOf(t.employeeId),
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
        _count: { select: { orders: true } },
      },
    }),
    prisma.employee.count({ where }),
  ]);

  const data = rows.map((e) => ({
    id: e.id,
    userId: e.user.id,
    name: e.user.fullName,
    email: e.user.email,
    phone: e.user.phone,
    employeeCode: e.employeeCode,
    department: e.department,
    program: e.program,
    monthlySalary: toNumber(e.monthlySalary),
    creditLimit: e.creditLimit === null ? null : toNumber(e.creditLimit),
    status: e.user.status,
    orderCount: e._count.orders,
    createdAt: e.createdAt,
  }));
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
