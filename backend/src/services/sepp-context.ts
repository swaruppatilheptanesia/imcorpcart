import { prisma } from '../config/prisma';
import { toNumber } from '../models/serializers';
import type { SeppParams } from './sepp-calc';

// The Smart-EPP inputs that apply to one employee: the company must have SEPP
// enabled AND a leasing company attached; the leasing company's lease
// parameters + the company's ADLD / tax slab feed the calculator. `available`
// is the employee's remaining purchase limit (ledger-backed, see credit.service).
// Null → Smart EPP is not offered to this employee.
export interface SeppContext {
  companyId: string;
  leasingCompanyId: string;
  leasingCompanyName: string;
  params: Omit<SeppParams, 'gstPct'>; // gstPct comes from each product
  limit: number;
  reserved: number;
  available: number;
}

export async function getSeppContext(employeeId: string): Promise<SeppContext | null> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      creditLimit: true,
      creditAccount: { select: { creditLimit: true, availableCredit: true, reservedCredit: true } },
      company: {
        select: {
          id: true,
          smartEppEnabled: true,
          adldPct: true,
          incomeTaxPct: true,
          leasingCompany: {
            select: {
              id: true,
              name: true,
              status: true,
              ptpm: true,
              defaultTenureMonths: true,
              repurchasePct: true,
              pvDiscountLeasePct: true,
              pvDiscountRepurchasePct: true,
              advanceFeeType: true,
              advanceFeeValue: true,
            },
          },
        },
      },
    },
  });
  const co = employee?.company;
  const lc = co?.leasingCompany;
  if (!employee || !co?.smartEppEnabled || !lc || lc.status !== 'ACTIVE') return null;

  // Ledger account may not exist yet (created lazily on first reserve) — until
  // then the HR-set limit is fully available.
  const limit = employee.creditAccount ? toNumber(employee.creditAccount.creditLimit) : toNumber(employee.creditLimit);
  const reserved = employee.creditAccount ? toNumber(employee.creditAccount.reservedCredit) : 0;
  const available = employee.creditAccount ? toNumber(employee.creditAccount.availableCredit) : limit;

  return {
    companyId: co.id,
    leasingCompanyId: lc.id,
    leasingCompanyName: lc.name,
    params: {
      ptpm: toNumber(lc.ptpm),
      tenureMonths: lc.defaultTenureMonths,
      incomeTaxPct: toNumber(co.incomeTaxPct),
      repurchasePct: toNumber(lc.repurchasePct),
      pvDiscountLeasePct: toNumber(lc.pvDiscountLeasePct),
      pvDiscountRepurchasePct: toNumber(lc.pvDiscountRepurchasePct),
      adldPct: co.adldPct != null ? toNumber(co.adldPct) : 0,
      advanceFeeType: lc.advanceFeeType,
      advanceFeeValue: toNumber(lc.advanceFeeValue),
    },
    limit,
    reserved,
    available: Math.max(0, available),
  };
}
