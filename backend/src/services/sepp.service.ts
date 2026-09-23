import { Prisma, SmartEppStatus, ApprovalStage } from '@prisma/client';
import { nanoid } from 'nanoid';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { getRazorpay } from '../config/razorpay';
import { AppError } from '../utils/AppError';
import { serialize, toNumber } from '../models/serializers';
import { resolveEmployee } from '../utils/scope';
import {
  loadCart,
  toStoreProduct,
  pickBuyBox,
  isVoucherProduct,
  seppAssetCost,
  verifyRazorpaySignature,
  refundQuietly,
  assertNotViewOnly,
} from './shop.service';
import { getSeppContext } from './sepp-context';
import { computeSeppQuote, computeAdvance, scaleSeppQuote, sumSeppQuotes, type SeppQuote } from './sepp-calc';
import { reserveCredit, releaseCredit } from './credit.service';
import { notifySepp } from './sepp-notify';
import type { SubmitSeppRequestInput } from '../validators/sepp.schema';

const D = (n: number) => new Prisma.Decimal(n);

// ─────────────────────────────────────────────────────────────────────────────
// Smart EPP — employee side. A request is the lease-financed counterpart of a
// checkout: the cart is priced with the lease calculator, the employee pays only
// the leasing company's advance (Razorpay), the amount is RESERVED against their
// purchase limit, and the request enters the HR → Leasing approval chain. Orders
// are created only when the leasing company approves (Phase 2).
// ─────────────────────────────────────────────────────────────────────────────

// Shared read shape for a request (employee / HR / leasing views).
export const seppRequestInclude = {
  employee: {
    select: {
      id: true,
      employeeCode: true,
      department: true,
      monthlySalary: true,
      user: { select: { fullName: true, email: true } },
    },
  },
  company: { select: { id: true, name: true } },
  address: true,
  items: {
    select: {
      productId: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      product: {
        select: {
          name: true,
          brand: true,
          sku: true,
          category: { select: { slug: true } },
          images: { orderBy: { position: 'asc' }, take: 1, select: { url: true } },
        },
      },
    },
  },
  approvals: {
    orderBy: { sequence: 'asc' },
    select: {
      stage: true,
      sequence: true,
      status: true,
      comments: true,
      decidedAt: true,
      approver: { select: { fullName: true } },
    },
  },
  leaseTerms: {
    select: {
      tenureMonths: true,
      emiAmount: true,
      downPayment: true,
      financedAmount: true,
      leasingCompany: { select: { name: true } },
      installments: { orderBy: { installmentNo: 'asc' } },
    },
  },
  orders: { select: { orderNo: true, status: true }, orderBy: { orderNo: 'asc' } },
} satisfies Prisma.SmartEppRequestInclude;

export type SeppRequestRow = Prisma.SmartEppRequestGetPayload<{ include: typeof seppRequestInclude }>;

export function toSeppRequestView(r: SeppRequestRow) {
  return {
    id: r.id,
    requestNo: r.requestNo,
    status: r.status,
    employee: {
      id: r.employee.id,
      name: r.employee.user.fullName,
      email: r.employee.user.email,
      employeeCode: r.employee.employeeCode,
      department: r.employee.department,
      monthlySalary: toNumber(r.employee.monthlySalary),
    },
    company: r.company,
    address: {
      id: r.address.id,
      label: r.address.label,
      contactName: r.address.contactName,
      contactPhone: r.address.contactPhone,
      line1: r.address.line1,
      line2: r.address.line2,
      city: r.address.city,
      state: r.address.state,
      pincode: r.address.pincode,
    },
    quote: (r.quote ?? null) as SeppQuote | null,
    totalAmount: toNumber(r.totalAmount),
    advanceAmount: toNumber(r.advanceAmount),
    advancePaidAt: r.advancePaidAt,
    advanceRefundedAt: r.advanceRefundedAt,
    submittedAt: r.submittedAt,
    decidedAt: r.decidedAt,
    checkoutGroup: r.checkoutGroup,
    items: r.items.map((i) => ({
      productId: i.productId,
      name: i.product.name,
      brand: i.product.brand ?? '',
      sku: i.product.sku,
      group: i.product.category.slug,
      image: i.product.images[0]?.url ?? null,
      quantity: i.quantity,
      unitPrice: toNumber(i.unitPrice),
      lineTotal: toNumber(i.lineTotal),
    })),
    approvals: r.approvals.map((a) => ({
      stage: a.stage,
      sequence: a.sequence,
      status: a.status,
      approver: a.approver?.fullName ?? null,
      comments: a.comments,
      decidedAt: a.decidedAt,
    })),
    leaseTerms: r.leaseTerms
      ? {
          leasingCompany: r.leaseTerms.leasingCompany.name,
          tenureMonths: r.leaseTerms.tenureMonths,
          emiAmount: toNumber(r.leaseTerms.emiAmount),
          downPayment: toNumber(r.leaseTerms.downPayment),
          financedAmount: toNumber(r.leaseTerms.financedAmount),
          installments: r.leaseTerms.installments.map((i) => ({
            installmentNo: i.installmentNo,
            dueDate: i.dueDate,
            amount: toNumber(i.amount),
            paidAt: i.paidAt,
          })),
        }
      : null,
    orders: r.orders,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// The amount held against the purchase limit for a request — the tenure's
// pre-tax deduction from the stored quote (falls back to the asset total).
export function reservedAmountOf(r: { quote: Prisma.JsonValue | null; totalAmount: Prisma.Decimal }): number {
  const q = r.quote as SeppQuote | null;
  return q?.totalPreTaxDeduction ?? toNumber(r.totalAmount);
}

// Refund the advance (if paid and not yet refunded). Best-effort — a gateway
// failure is audited for the admin rather than blocking the rejection.
export async function refundAdvance(requestId: string): Promise<boolean> {
  const r = await prisma.smartEppRequest.findUnique({
    where: { id: requestId },
    select: { id: true, requestNo: true, advanceTxnId: true, advanceAmount: true, advanceRefundedAt: true, employee: { select: { userId: true } } },
  });
  if (!r?.advanceTxnId || r.advanceRefundedAt) return true;
  const ok = await refundQuietly(r.advanceTxnId);
  if (ok) {
    await prisma.smartEppRequest.update({ where: { id: r.id }, data: { advanceRefundedAt: new Date() } });
  } else {
    await prisma.auditLog
      .create({
        data: {
          actorId: r.employee.userId,
          action: 'sepp.advance_refund_failed',
          entityType: 'SmartEppRequest',
          entityId: r.id,
          after: { requestNo: r.requestNo, txn: r.advanceTxnId, amountInr: toNumber(r.advanceAmount) },
        },
      })
      .catch(() => undefined);
  }
  return ok;
}

// ─── Cart quote ──────────────────────────────────────────────────────────────

// Price the current cart on the lease calculator. Hard problems (empty cart,
// out-of-stock, gift card) throw; soft gates (no phone, over limit) come back
// as `issues` so the storefront can explain what to fix before submitting.
export async function quoteCart(userId: string) {
  const { id: employeeId, companyId } = await resolveEmployee(userId);
  const ctx = await getSeppContext(employeeId);
  if (!ctx) throw AppError.forbidden('Smart EPP is not available for your company');

  const cart = await loadCart(employeeId);
  if (!cart || cart.items.length === 0) throw AppError.badRequest('Your cart is empty');

  const lines = cart.items.map((it) => {
    const p = toStoreProduct(it.product);
    if (isVoucherProduct(it.product)) {
      throw AppError.badRequest(`Gift cards can't be bought on Smart EPP — remove "${p.name}" from your cart`);
    }
    const offer = pickBuyBox(it.product.offers);
    const assetCost = seppAssetCost(it.product, offer);
    if (!offer || assetCost == null) throw AppError.badRequest(`"${p.name}" is out of stock`);
    const gstPct = it.product.gstPercent != null ? toNumber(it.product.gstPercent) : 18;
    const unit = computeSeppQuote(assetCost, { ...ctx.params, gstPct });
    return {
      it,
      p,
      offer,
      resellerId: offer.resellerId ?? null,
      assetCost,
      unit,
      line: scaleSeppQuote(unit, it.quantity),
    };
  });

  const quote = sumSeppQuotes(lines.map((l) => l.line));
  const advance = computeAdvance(quote.assetCost, ctx.params);
  const hasPhone = lines.some((l) => l.p.group === 'phones');
  const withinLimit = quote.totalPreTaxDeduction <= ctx.available;
  const issues: string[] = [];
  if (!hasPhone) issues.push('A phone is required for a Smart EPP request — accessories can only be added alongside one.');
  if (!withinLimit) {
    issues.push(
      `This request needs ₹${quote.totalPreTaxDeduction.toLocaleString('en-IN')} of your Smart EPP limit but only ₹${ctx.available.toLocaleString('en-IN')} is available.`,
    );
  }

  const branches = await prisma.address.findMany({
    where: { companyId, employeeId: null },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  if (!branches.length) issues.push('Your company has not set up an office delivery address yet — ask your HR admin.');

  return { employeeId, companyId, cart, ctx, lines, quote, advance, hasPhone, withinLimit, branches, issues };
}

export async function getCartQuote(userId: string) {
  const q = await quoteCart(userId);
  return serialize({
    lines: q.lines.map((l) => ({
      itemId: l.it.id,
      productId: l.it.productId,
      name: l.p.name,
      brand: l.p.brand,
      group: l.p.group,
      image: l.p.image,
      qty: l.it.quantity,
      assetCost: l.assetCost,
      monthlyEmi: l.unit.monthlyRental,
      emiExGst: l.unit.preTaxDeduction,
      lineMonthlyEmi: l.line.monthlyRental,
      lineTotalDeduction: l.line.totalPreTaxDeduction,
    })),
    quote: q.quote,
    advance: q.advance,
    hasPhone: q.hasPhone,
    withinLimit: q.withinLimit,
    limit: q.ctx.limit,
    available: q.ctx.available,
    leasingCompany: q.ctx.leasingCompanyName,
    branches: q.branches.map((b) => ({
      id: b.id,
      label: b.label,
      contactName: b.contactName,
      contactPhone: b.contactPhone,
      line1: b.line1,
      line2: b.line2,
      city: b.city,
      state: b.state,
      pincode: b.pincode,
      isDefault: b.isDefault,
    })),
    canSubmit: q.issues.length === 0,
    issues: q.issues,
  });
}

function assertCheckoutOpen() {
  if (!env.CHECKOUT_ENABLED) {
    throw AppError.forbidden('Smart EPP requests are temporarily unavailable — online payments are launching soon');
  }
}

function assertSubmittable(q: Awaited<ReturnType<typeof quoteCart>>) {
  if (q.issues.length) throw AppError.badRequest(q.issues[0]);
}

// ─── Advance payment (Razorpay order for the leasing company's fee) ──────────

export async function createAdvanceOrder(userId: string) {
  assertCheckoutOpen();
  await assertNotViewOnly(userId);
  const q = await quoteCart(userId);
  assertSubmittable(q);
  if (q.advance <= 0) throw AppError.badRequest('No advance is payable — submit the request directly');

  const razorpay = getRazorpay();
  const orderParams: Record<string, unknown> = {
    amount: Math.round(q.advance * 100),
    currency: 'INR',
    receipt: `sepp_${nanoid(10)}`,
    notes: { kind: 'SMART_EPP_ADVANCE', employeeId: q.employeeId },
  };
  if (env.RAZORPAY_CHECKOUT_CONFIG_ID) orderParams.checkout_config_id = env.RAZORPAY_CHECKOUT_CONFIG_ID;
  const rz = await razorpay.orders.create(orderParams as unknown as Parameters<typeof razorpay.orders.create>[0]);
  return { keyId: env.RAZORPAY_KEY_ID, rzpOrderId: rz.id, amount: Number(rz.amount), currency: rz.currency, total: q.advance };
}

// ─── Submit ──────────────────────────────────────────────────────────────────

export async function submitRequest(userId: string, input: SubmitSeppRequestInput) {
  assertCheckoutOpen();
  await assertNotViewOnly(userId);
  const q = await quoteCart(userId);
  assertSubmittable(q);

  const address = q.branches.find((b) => b.id === input.addressId);
  if (!address) throw AppError.badRequest("Choose one of your company's office addresses for delivery");

  // Advance: verify the signed Razorpay result exactly like an EPP checkout.
  let advanceGatewayOrderId: string | null = null;
  let advanceTxnId: string | null = null;
  if (q.advance > 0) {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = input;
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      throw AppError.badRequest('The advance payment is required to submit this request');
    }
    verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
    const reused = await prisma.smartEppRequest.findFirst({ where: { advanceTxnId: razorpayPaymentId }, select: { id: true } });
    if (reused) throw AppError.conflict('This payment has already been used for a request');
    const payment = await getRazorpay().payments.fetch(razorpayPaymentId);
    if (payment.order_id !== razorpayOrderId) {
      throw AppError.badRequest('Payment does not match this request — please retry');
    }
    if (Number(payment.amount) !== Math.round(q.advance * 100)) {
      await refundQuietly(razorpayPaymentId);
      throw AppError.badRequest('Paid amount does not match the advance due — you have been refunded, please retry');
    }
    if (payment.status !== 'captured' && payment.status !== 'authorized') {
      throw AppError.badRequest('Payment was not completed — please retry');
    }
    advanceGatewayOrderId = razorpayOrderId;
    advanceTxnId = razorpayPaymentId;
  }

  const requestNo = `SEPP-${Date.now().toString().slice(-8)}`;
  let created: { id: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      const req = await tx.smartEppRequest.create({
        data: {
          requestNo,
          employeeId: q.employeeId,
          companyId: q.companyId,
          status: SmartEppStatus.SUBMITTED,
          totalAmount: D(q.quote.assetCost),
          submittedAt: new Date(),
          addressId: address.id,
          quote: q.quote as unknown as Prisma.InputJsonValue,
          advanceAmount: D(q.advance),
          advanceGatewayOrderId,
          advanceTxnId,
          advancePaidAt: advanceTxnId ? new Date() : null,
          items: {
            create: q.lines.map((l) => ({
              productId: l.it.productId,
              quantity: l.it.quantity,
              unitPrice: D(l.assetCost),
              lineTotal: D(l.assetCost * l.it.quantity),
            })),
          },
          approvals: {
            create: [
              { stage: ApprovalStage.HR, sequence: 1 },
              { stage: ApprovalStage.LEASING, sequence: 2 },
            ],
          },
        },
        select: { id: true },
      });
      // Hold the tenure's pre-tax deduction against the purchase limit (throws if
      // the limit moved since the quote → the whole request rolls back).
      await reserveCredit(tx, q.employeeId, q.quote.totalPreTaxDeduction, {
        referenceType: 'SMART_EPP_REQUEST',
        referenceId: req.id,
        note: `Reserved for Smart EPP request ${requestNo}`,
      });
      await tx.cartItem.deleteMany({ where: { cartId: q.cart.id } });
      return req;
    });
  } catch (e) {
    if (advanceTxnId) {
      const reason = e instanceof Error ? e.message : 'Unknown error';
      console.error('[sepp] request creation failed after advance capture; refunding', advanceTxnId, e);
      const refunded = await refundQuietly(advanceTxnId);
      await prisma.auditLog
        .create({
          data: {
            actorId: userId,
            action: 'checkout.failed_refunded',
            entityType: 'Payment',
            entityId: advanceTxnId,
            after: { reason, amountInr: q.advance, rzpOrderId: advanceGatewayOrderId, employeeId: q.employeeId, companyId: q.companyId, refunded, kind: 'SMART_EPP_ADVANCE' },
          },
        })
        .catch(() => undefined);
      throw AppError.badRequest(
        refunded
          ? `We couldn't submit your request (${reason}). Your advance has been refunded — please try again.`
          : `We couldn't submit your request (${reason}) and the automatic refund failed — our team has been notified and will refund you.`,
      );
    }
    throw e;
  }

  void notifySepp(created.id, 'SUBMITTED');
  return getRequestById(created.id);
}

// ─── Read / cancel ───────────────────────────────────────────────────────────

async function getRequestById(id: string) {
  const r = await prisma.smartEppRequest.findUnique({ where: { id }, include: seppRequestInclude });
  if (!r) throw AppError.notFound('Request not found');
  return serialize(toSeppRequestView(r));
}

export async function listRequests(userId: string) {
  const { id: employeeId } = await resolveEmployee(userId);
  const rows = await prisma.smartEppRequest.findMany({
    where: { employeeId, status: { not: SmartEppStatus.DRAFT } },
    include: seppRequestInclude,
    orderBy: { createdAt: 'desc' },
  });
  return { data: serialize(rows.map(toSeppRequestView)) };
}

export async function getRequest(userId: string, no: string) {
  const { id: employeeId } = await resolveEmployee(userId);
  const r = await prisma.smartEppRequest.findFirst({
    where: { employeeId, OR: [{ requestNo: no }, { id: no }] },
    include: seppRequestInclude,
  });
  if (!r) throw AppError.notFound('Request not found');
  return serialize(toSeppRequestView(r));
}

// The employee can withdraw only while HR hasn't acted yet.
export async function cancelRequest(userId: string, no: string) {
  const { id: employeeId } = await resolveEmployee(userId);
  const r = await prisma.smartEppRequest.findFirst({ where: { employeeId, OR: [{ requestNo: no }, { id: no }] } });
  if (!r) throw AppError.notFound('Request not found');
  if (r.status !== SmartEppStatus.SUBMITTED) {
    throw AppError.badRequest('This request can no longer be cancelled — contact your HR admin');
  }
  await prisma.$transaction(async (tx) => {
    await tx.smartEppRequest.update({
      where: { id: r.id },
      data: { status: SmartEppStatus.CANCELLED, decidedAt: new Date() },
    });
    await releaseCredit(tx, employeeId, reservedAmountOf(r), {
      referenceType: 'SMART_EPP_REQUEST',
      referenceId: r.id,
      note: `Released — request ${r.requestNo} cancelled by employee`,
    });
  });
  await refundAdvance(r.id);
  void notifySepp(r.id, 'CANCELLED');
  return getRequestById(r.id);
}
