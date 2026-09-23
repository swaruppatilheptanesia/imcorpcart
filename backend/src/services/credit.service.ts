import { Prisma, CreditLedgerType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { toNumber } from '../models/serializers';

// ─────────────────────────────────────────────────────────────────────────────
// Smart-EPP purchase-limit ledger. Mirrors the wallet ledger (shop.service):
// an append-only CreditLedgerEntry per movement + cached balances on
// CreditAccount. Semantics of the cached columns:
//   creditLimit      — HR-set ceiling (Employee.creditLimit, synced here)
//   reservedCredit   — committed by requests still awaiting approval
//   availableCredit  — limit − reserved − consumed (consumed = approved leases
//                      not yet repaid; each HR-recorded EMI payment REPLENISHes)
// ─────────────────────────────────────────────────────────────────────────────

type Tx = Prisma.TransactionClient;
interface Ref { referenceType?: string; referenceId?: string; note?: string }
const D = (n: number) => new Prisma.Decimal(n);

// Get-or-create the employee's account, syncing the limit with the HR-set
// Employee.creditLimit (a raised/lowered limit moves availableCredit by the delta
// and leaves an ADJUST entry so the change is auditable).
export async function ensureCreditAccount(tx: Tx, employeeId: string) {
  const emp = await tx.employee.findUnique({ where: { id: employeeId }, select: { creditLimit: true } });
  const limit = emp?.creditLimit != null ? toNumber(emp.creditLimit) : 0;
  let acct = await tx.creditAccount.findUnique({ where: { employeeId } });
  if (!acct) {
    acct = await tx.creditAccount.create({
      data: { employeeId, creditLimit: D(limit), availableCredit: D(limit), reservedCredit: D(0) },
    });
    return acct;
  }
  const current = toNumber(acct.creditLimit);
  if (current !== limit) {
    const delta = limit - current;
    const availableAfter = toNumber(acct.availableCredit) + delta;
    acct = await tx.creditAccount.update({
      where: { id: acct.id },
      data: { creditLimit: D(limit), availableCredit: D(availableAfter) },
    });
    await tx.creditLedgerEntry.create({
      data: {
        creditAccountId: acct.id,
        type: CreditLedgerType.ADJUST,
        amount: D(delta),
        balanceAfter: D(availableAfter),
        referenceType: 'EMPLOYEE',
        referenceId: employeeId,
        note: `Purchase limit changed to ₹${limit.toLocaleString('en-IN')}`,
      },
    });
  }
  return acct;
}

export interface CreditSummary { limit: number; reserved: number; consumed: number; available: number }

export async function getCreditSummary(employeeId: string): Promise<CreditSummary> {
  const acct = await prisma.$transaction((tx) => ensureCreditAccount(tx, employeeId));
  const limit = toNumber(acct.creditLimit);
  const reserved = toNumber(acct.reservedCredit);
  const available = toNumber(acct.availableCredit);
  return { limit, reserved, available: Math.max(0, available), consumed: Math.max(0, limit - reserved - available) };
}

async function move(
  tx: Tx,
  employeeId: string,
  type: CreditLedgerType,
  amount: number,
  patch: (acct: { available: number; reserved: number; limit: number }) => { available: number; reserved: number },
  ref: Ref,
) {
  if (amount <= 0) return;
  const acct = await ensureCreditAccount(tx, employeeId);
  const cur = { available: toNumber(acct.availableCredit), reserved: toNumber(acct.reservedCredit), limit: toNumber(acct.creditLimit) };
  const next = patch(cur);
  await tx.creditAccount.update({
    where: { id: acct.id },
    data: { availableCredit: D(next.available), reservedCredit: D(next.reserved) },
  });
  await tx.creditLedgerEntry.create({
    data: {
      creditAccountId: acct.id,
      type,
      amount: D(amount),
      balanceAfter: D(next.available),
      referenceType: ref.referenceType ?? null,
      referenceId: ref.referenceId ?? null,
      note: ref.note ?? null,
    },
  });
}

// Request submitted → hold the amount against the limit.
export async function reserveCredit(tx: Tx, employeeId: string, amount: number, ref: Ref = {}) {
  await move(tx, employeeId, CreditLedgerType.RESERVE, amount, (c) => {
    if (c.available < amount) {
      throw AppError.badRequest(
        `This request needs ₹${amount.toLocaleString('en-IN')} of your Smart EPP limit but only ₹${Math.max(0, c.available).toLocaleString('en-IN')} is available`,
      );
    }
    return { available: c.available - amount, reserved: c.reserved + amount };
  }, ref);
}

// Rejected / cancelled → give the hold back.
export async function releaseCredit(tx: Tx, employeeId: string, amount: number, ref: Ref = {}) {
  await move(tx, employeeId, CreditLedgerType.RELEASE, amount, (c) => ({
    available: Math.min(c.limit, c.available + amount),
    reserved: Math.max(0, c.reserved - amount),
  }), ref);
}

// Leasing approved → the hold becomes a real commitment (stays unavailable).
export async function consumeCredit(tx: Tx, employeeId: string, amount: number, ref: Ref = {}) {
  await move(tx, employeeId, CreditLedgerType.CONSUME, amount, (c) => ({
    available: c.available,
    reserved: Math.max(0, c.reserved - amount),
  }), ref);
}

// HR recorded an EMI payment → that slice of the limit is usable again.
export async function replenishCredit(tx: Tx, employeeId: string, amount: number, ref: Ref = {}) {
  await move(tx, employeeId, CreditLedgerType.REPLENISH, amount, (c) => ({
    available: Math.min(c.limit - c.reserved, c.available + amount),
    reserved: c.reserved,
  }), ref);
}
