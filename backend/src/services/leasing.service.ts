import {
  Prisma,
  SmartEppStatus,
  ApprovalStage,
  ApprovalStatus,
  OrderStatus,
  OrderType,
  OrderSource,
} from '@prisma/client';
import { nanoid } from 'nanoid';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { serialize, toNumber } from '../models/serializers';
import { resolveLeasingCompanyId } from '../utils/scope';
import { shopProductInclude, pickBuyBox } from './shop.service';
import { computeSeppQuote, computeAdvance, DEFAULT_SEPP_PARAMS, type SeppParams, type SeppQuote } from './sepp-calc';
import { consumeCredit, releaseCredit } from './credit.service';
import { seppRequestInclude, toSeppRequestView, reservedAmountOf, refundAdvance } from './sepp.service';
import { notifySepp } from './sepp-notify';
import type {
  LeasingParamsInput,
  LeasingPreviewInput,
  LeasingRequestListQuery,
  LeasingDecisionInput,
} from '../validators/leasing.schema';

const D = (n: number) => new Prisma.Decimal(n);

// ─────────────────────────────────────────────────────────────────────────────
// Leasing-company portal — stage 2 of the Smart-EPP approval chain. The leasing
// company tunes the lease parameters every attached company's calculator uses,
// sees requests HR has already approved, and on approval finances the devices:
// LeaseTerms + an installment schedule are written and the request turns into
// real orders (one per fulfilling seller, like an EPP checkout) — no Payment rows,
// since the corporate pays the leasing company via payroll, off-platform.
// ─────────────────────────────────────────────────────────────────────────────

// The PDF illustration device — a stable sample for the Settings preview.
const SAMPLE_ASSET_COST = 98_900;

function toParamsView(lc: {
  id: string;
  name: string;
  gstin: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: string;
  ptpm: Prisma.Decimal;
  defaultTenureMonths: number;
  repurchasePct: Prisma.Decimal;
  pvDiscountLeasePct: Prisma.Decimal;
  pvDiscountRepurchasePct: Prisma.Decimal;
  advanceFeeType: 'FIXED' | 'PERCENT';
  advanceFeeValue: Prisma.Decimal;
}) {
  return {
    id: lc.id,
    name: lc.name,
    gstin: lc.gstin,
    contactEmail: lc.contactEmail,
    contactPhone: lc.contactPhone,
    status: lc.status,
    ptpm: toNumber(lc.ptpm),
    defaultTenureMonths: lc.defaultTenureMonths,
    repurchasePct: toNumber(lc.repurchasePct),
    pvDiscountLeasePct: toNumber(lc.pvDiscountLeasePct),
    pvDiscountRepurchasePct: toNumber(lc.pvDiscountRepurchasePct),
    advanceFeeType: lc.advanceFeeType,
    advanceFeeValue: toNumber(lc.advanceFeeValue),
  };
}

async function loadLeasingCompany(leasingCompanyId: string) {
  const lc = await prisma.leasingCompany.findUnique({ where: { id: leasingCompanyId } });
  if (!lc) throw AppError.notFound('Leasing company not found');
  return lc;
}

function sampleQuote(p: ReturnType<typeof toParamsView>) {
  const params: SeppParams = {
    ...DEFAULT_SEPP_PARAMS,
    ptpm: p.ptpm,
    tenureMonths: p.defaultTenureMonths,
    repurchasePct: p.repurchasePct,
    pvDiscountLeasePct: p.pvDiscountLeasePct,
    pvDiscountRepurchasePct: p.pvDiscountRepurchasePct,
    advanceFeeType: p.advanceFeeType,
    advanceFeeValue: p.advanceFeeValue,
  };
  return {
    assetCost: SAMPLE_ASSET_COST,
    quote: computeSeppQuote(SAMPLE_ASSET_COST, params),
    advance: computeAdvance(SAMPLE_ASSET_COST, params),
  };
}

// ─── Profile / dashboard ─────────────────────────────────────────────────────

export async function getProfile(userId: string) {
  const leasingCompanyId = await resolveLeasingCompanyId(userId);
  const [lc, operator, companies, pending, approved, rejected, activeLeases] = await Promise.all([
    loadLeasingCompany(leasingCompanyId),
    prisma.user.findUnique({ where: { id: userId }, select: { fullName: true, email: true } }),
    prisma.company.count({ where: { leasingCompanyId, deletedAt: null } }),
    prisma.smartEppRequest.count({ where: { company: { leasingCompanyId }, status: SmartEppStatus.HR_APPROVED } }),
    prisma.smartEppRequest.count({
      where: { company: { leasingCompanyId }, status: { in: [SmartEppStatus.APPROVED, SmartEppStatus.ORDERED] } },
    }),
    prisma.smartEppRequest.count({
      where: { company: { leasingCompanyId }, status: SmartEppStatus.REJECTED, approvals: { some: { stage: ApprovalStage.LEASING, status: ApprovalStatus.REJECTED } } },
    }),
    prisma.leaseTerms.aggregate({ where: { leasingCompanyId }, _sum: { financedAmount: true, emiAmount: true } }),
  ]);
  return serialize({
    ...toParamsView(lc),
    operator: operator ? { name: operator.fullName, email: operator.email } : null,
    stats: {
      companies,
      pendingRequests: pending,
      approvedRequests: approved,
      rejectedRequests: rejected,
      financedTotal: toNumber(activeLeases._sum.financedAmount),
      monthlyBook: toNumber(activeLeases._sum.emiAmount),
    },
  });
}

// ─── Lease parameters ────────────────────────────────────────────────────────

export async function getParams(userId: string) {
  const leasingCompanyId = await resolveLeasingCompanyId(userId);
  const lc = await loadLeasingCompany(leasingCompanyId);
  const view = toParamsView(lc);
  return serialize({ ...view, sample: sampleQuote(view) });
}

export async function updateParams(userId: string, input: LeasingParamsInput) {
  const leasingCompanyId = await resolveLeasingCompanyId(userId);
  const data: Prisma.LeasingCompanyUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone ?? null;
  if (input.ptpm !== undefined) data.ptpm = D(input.ptpm);
  if (input.defaultTenureMonths !== undefined) data.defaultTenureMonths = input.defaultTenureMonths;
  if (input.repurchasePct !== undefined) data.repurchasePct = D(input.repurchasePct);
  if (input.pvDiscountLeasePct !== undefined) data.pvDiscountLeasePct = D(input.pvDiscountLeasePct);
  if (input.pvDiscountRepurchasePct !== undefined) data.pvDiscountRepurchasePct = D(input.pvDiscountRepurchasePct);
  if (input.advanceFeeType !== undefined) data.advanceFeeType = input.advanceFeeType;
  if (input.advanceFeeValue !== undefined) data.advanceFeeValue = D(input.advanceFeeValue);
  if (input.advanceFeeType === 'PERCENT' || (input.advanceFeeType === undefined && input.advanceFeeValue !== undefined)) {
    const current = await loadLeasingCompany(leasingCompanyId);
    const type = input.advanceFeeType ?? current.advanceFeeType;
    const value = input.advanceFeeValue ?? toNumber(current.advanceFeeValue);
    if (type === 'PERCENT' && value > 100) throw AppError.badRequest('A percentage advance cannot exceed 100%');
  }
  const lc = await prisma.leasingCompany.update({ where: { id: leasingCompanyId }, data });
  const view = toParamsView(lc);
  return serialize({ ...view, sample: sampleQuote(view) });
}

// Unsaved-form preview: the Settings screen calls this on every change so the
// operator sees what a ₹98,900 phone would cost before committing the params.
export async function previewParams(userId: string, input: LeasingPreviewInput) {
  const leasingCompanyId = await resolveLeasingCompanyId(userId);
  const lc = await loadLeasingCompany(leasingCompanyId);
  const view = toParamsView(lc);
  const params: SeppParams = {
    ...DEFAULT_SEPP_PARAMS,
    ptpm: input.ptpm ?? view.ptpm,
    tenureMonths: input.defaultTenureMonths ?? view.defaultTenureMonths,
    repurchasePct: input.repurchasePct ?? view.repurchasePct,
    pvDiscountLeasePct: input.pvDiscountLeasePct ?? view.pvDiscountLeasePct,
    pvDiscountRepurchasePct: input.pvDiscountRepurchasePct ?? view.pvDiscountRepurchasePct,
    advanceFeeType: input.advanceFeeType ?? view.advanceFeeType,
    advanceFeeValue: input.advanceFeeValue ?? view.advanceFeeValue,
    gstPct: input.gstPct ?? DEFAULT_SEPP_PARAMS.gstPct,
    incomeTaxPct: input.incomeTaxPct ?? DEFAULT_SEPP_PARAMS.incomeTaxPct,
    adldPct: input.adldPct ?? DEFAULT_SEPP_PARAMS.adldPct,
  };
  const assetCost = input.assetCost ?? SAMPLE_ASSET_COST;
  return serialize({ assetCost, quote: computeSeppQuote(assetCost, params), advance: computeAdvance(assetCost, params) });
}

// ─── Attached companies ──────────────────────────────────────────────────────

export async function listCompanies(userId: string) {
  const leasingCompanyId = await resolveLeasingCompanyId(userId);
  const rows = await prisma.company.findMany({
    where: { leasingCompanyId, deletedAt: null },
    select: {
      id: true,
      name: true,
      emailDomain: true,
      status: true,
      smartEppEnabled: true,
      adldPct: true,
      incomeTaxPct: true,
      _count: { select: { employees: { where: { deletedAt: null } } } },
    },
    orderBy: { name: 'asc' },
  });
  const counts = await prisma.smartEppRequest.groupBy({
    by: ['companyId', 'status'],
    where: { company: { leasingCompanyId } },
    _count: { _all: true },
  });
  const byCompany = new Map<string, { pending: number; active: number; rejected: number }>();
  for (const c of counts) {
    const cur = byCompany.get(c.companyId) ?? { pending: 0, active: 0, rejected: 0 };
    if (c.status === SmartEppStatus.HR_APPROVED) cur.pending += c._count._all;
    else if (c.status === SmartEppStatus.APPROVED || c.status === SmartEppStatus.ORDERED) cur.active += c._count._all;
    else if (c.status === SmartEppStatus.REJECTED) cur.rejected += c._count._all;
    byCompany.set(c.companyId, cur);
  }
  return {
    data: serialize(
      rows.map((c) => ({
        id: c.id,
        name: c.name,
        domain: c.emailDomain,
        status: c.status,
        smartEppEnabled: c.smartEppEnabled,
        adldPct: c.adldPct != null ? toNumber(c.adldPct) : null,
        incomeTaxPct: toNumber(c.incomeTaxPct),
        employees: c._count.employees,
        requests: byCompany.get(c.id) ?? { pending: 0, active: 0, rejected: 0 },
      })),
    ),
  };
}

// ─── Requests (stage-2 queue) ────────────────────────────────────────────────

// The leasing company only ever sees requests that HR has passed to it.
const LEASING_VISIBLE: SmartEppStatus[] = [
  SmartEppStatus.HR_APPROVED,
  SmartEppStatus.LEASING_APPROVED,
  SmartEppStatus.APPROVED,
  SmartEppStatus.ORDERED,
  SmartEppStatus.REJECTED,
];

export async function listRequests(userId: string, query: LeasingRequestListQuery) {
  const leasingCompanyId = await resolveLeasingCompanyId(userId);
  const where: Prisma.SmartEppRequestWhereInput = {
    company: { leasingCompanyId },
    status: { in: LEASING_VISIBLE },
  };
  switch (query.status) {
    case 'PENDING':
      where.status = SmartEppStatus.HR_APPROVED;
      break;
    case 'APPROVED':
      where.status = { in: [SmartEppStatus.LEASING_APPROVED, SmartEppStatus.APPROVED, SmartEppStatus.ORDERED] };
      break;
    case 'REJECTED':
      // Only rejections this desk made — HR rejections never reached it.
      where.status = SmartEppStatus.REJECTED;
      where.approvals = { some: { stage: ApprovalStage.LEASING, status: ApprovalStatus.REJECTED } };
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

async function findScoped(leasingCompanyId: string, id: string) {
  const r = await prisma.smartEppRequest.findFirst({
    where: { id, company: { leasingCompanyId }, status: { in: LEASING_VISIBLE } },
    include: seppRequestInclude,
  });
  if (!r) throw AppError.notFound('Request not found');
  return r;
}

export async function getRequest(userId: string, id: string) {
  const leasingCompanyId = await resolveLeasingCompanyId(userId);
  return serialize(toSeppRequestView(await findScoped(leasingCompanyId, id)));
}

// Approve → LeaseTerms + schedule + orders + CONSUME; reject → RELEASE + refund.
export async function decideRequest(userId: string, id: string, input: LeasingDecisionInput) {
  const leasingCompanyId = await resolveLeasingCompanyId(userId);
  const r = await findScoped(leasingCompanyId, id);
  if (r.status !== SmartEppStatus.HR_APPROVED) {
    throw AppError.badRequest('This request is not awaiting leasing approval');
  }
  const hr = r.approvals.find((a) => a.stage === ApprovalStage.HR);
  if (hr?.status !== ApprovalStatus.APPROVED) throw AppError.badRequest('HR has not approved this request yet');
  const step = await prisma.approvalStep.findFirst({ where: { requestId: r.id, stage: ApprovalStage.LEASING } });
  if (!step || step.status !== ApprovalStatus.PENDING) throw AppError.badRequest('Leasing approval has already been recorded');

  const approved = input.decision === 'APPROVED';
  const now = new Date();

  if (!approved) {
    await prisma.$transaction(async (tx) => {
      await tx.approvalStep.update({
        where: { id: step.id },
        data: { status: ApprovalStatus.REJECTED, approverUserId: userId, comments: input.comments ?? null, decidedAt: now },
      });
      await tx.smartEppRequest.update({ where: { id: r.id }, data: { status: SmartEppStatus.REJECTED, decidedAt: now } });
      await releaseCredit(tx, r.employeeId, reservedAmountOf(r), {
        referenceType: 'SMART_EPP_REQUEST',
        referenceId: r.id,
        note: `Released — request ${r.requestNo} rejected by leasing company`,
      });
    });
    await refundAdvance(r.id);
    void notifySepp(r.id, 'REJECTED');
    return getRequest(userId, r.id);
  }

  // ── Approve ──
  const quote = r.quote as SeppQuote | null;
  const tenureMonths = input.tenureMonths ?? quote?.tenureMonths ?? 12;
  const emiAmount = input.emiAmount ?? quote?.monthlyRental ?? 0;
  if (emiAmount <= 0) throw AppError.badRequest('An EMI amount is required to approve this request');
  const assetTotal = toNumber(r.totalAmount);
  const ptpm = quote ? (quote.monthlyRental / quote.assetCost) * 1000 : 0;

  // Re-resolve the fulfilling seller per line from today's buy box (the request
  // stores asset prices, not sellers), so the orders land with whoever can ship.
  const products = await prisma.product.findMany({
    where: { id: { in: r.items.map((i) => i.productId) } },
    include: shopProductInclude,
  });
  const byProduct = new Map(products.map((p) => [p.id, p]));
  type Line = { productId: string; quantity: number; unitPrice: number; name: string };
  const groups = new Map<string | null, Line[]>();
  for (const it of r.items) {
    const p = byProduct.get(it.productId);
    if (!p) throw AppError.badRequest(`"${it.product.name}" is no longer in the catalogue`);
    const offer = pickBuyBox(p.offers);
    if (!offer) throw AppError.badRequest(`"${it.product.name}" is out of stock — ask the employee to re-submit`);
    const key = offer.resellerId ?? null;
    const arr = groups.get(key) ?? [];
    arr.push({ productId: it.productId, quantity: it.quantity, unitPrice: toNumber(it.unitPrice), name: it.product.name });
    groups.set(key, arr);
  }

  const checkoutGroup = nanoid(12);
  const baseNo = Date.now().toString().slice(-8);
  const sellerGroups = [...groups.entries()];

  await prisma.$transaction(async (tx) => {
    await tx.approvalStep.update({
      where: { id: step.id },
      data: { status: ApprovalStatus.APPROVED, approverUserId: userId, comments: input.comments ?? null, decidedAt: now },
    });

    // Lease terms + monthly schedule starting next month.
    const terms = await tx.leaseTerms.create({
      data: {
        requestId: r.id,
        leasingCompanyId,
        tenureMonths,
        interestRate: D(Math.round(ptpm * 100) / 100),
        downPayment: r.advanceAmount,
        financedAmount: D(assetTotal),
        emiAmount: D(emiAmount),
      },
    });
    const first = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    await tx.leaseScheduleInstallment.createMany({
      data: Array.from({ length: tenureMonths }, (_, i) => ({
        leaseTermsId: terms.id,
        installmentNo: i + 1,
        dueDate: new Date(first.getFullYear(), first.getMonth() + i, 1),
        amount: D(emiAmount),
      })),
    });

    // Orders: one per fulfilling seller, at asset cost, shipping to the branch.
    for (let gi = 0; gi < sellerGroups.length; gi += 1) {
      const [resellerId, lines] = sellerGroups[gi];
      const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
      await tx.order.create({
        data: {
          orderNo: sellerGroups.length > 1 ? `IMC-${baseNo}-${gi + 1}` : `IMC-${baseNo}`,
          type: OrderType.SMART_EPP,
          source: OrderSource.INTERNAL,
          employeeId: r.employeeId,
          companyId: r.companyId,
          resellerId,
          smartEppRequestId: r.id,
          checkoutGroup,
          addressId: r.addressId,
          billingAddressId: null,
          subtotal: D(subtotal),
          total: D(subtotal),
          status: OrderStatus.PLACED,
          statusHistory: {
            create: { status: OrderStatus.PLACED, changedById: userId, note: `Smart EPP approved by leasing company — request ${r.requestNo}` },
          },
          items: {
            create: lines.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              unitPrice: D(l.unitPrice),
              lineTotal: D(l.unitPrice * l.quantity),
            })),
          },
        },
      });
    }

    await tx.smartEppRequest.update({
      where: { id: r.id },
      data: { status: SmartEppStatus.ORDERED, decidedAt: now, checkoutGroup },
    });

    // The hold on the purchase limit becomes a commitment for the lease's life;
    // each HR-recorded EMI payment replenishes one month's slice (Phase 3).
    await consumeCredit(tx, r.employeeId, reservedAmountOf(r), {
      referenceType: 'SMART_EPP_REQUEST',
      referenceId: r.id,
      note: `Lease approved — request ${r.requestNo} (${tenureMonths} × ₹${emiAmount.toLocaleString('en-IN')})`,
    });
  });

  void notifySepp(r.id, 'ORDERED');
  return getRequest(userId, r.id);
}
