/** Smart EPP (lease-financed purchase) shapes shared by the storefront, the
 *  company (HR) portal and the leasing portal. Mirrors backend
 *  services/sepp-calc.ts + services/sepp.service.ts toSeppRequestView. */

// Whole-rupee lease figures for one asset (or a whole cart, summed).
export interface SeppQuote {
  assetCost: number; // incl. GST
  baseValue: number;
  gstOnAsset: number;
  tenureMonths: number;
  monthlyRental: number; // incl. GST
  gstInput: number;
  adldMonthly: number;
  preTaxDeduction: number;
  itShelter: number;
  postTaxDeduction: number;
  totalLease: number;
  totalPreTaxDeduction: number; // limit basis — "effective purchase" on cards
  totalItShelter: number;
  totalGstInput: number;
  repurchase: number;
  pvLease: number;
  pvRepurchase: number;
  effectivePrice: number;
  effectivePct: number;
}

// Per-unit Smart-EPP block attached to a StoreProduct for a SEPP-enabled shopper.
export interface SeppProductBlock {
  assetCost: number;
  monthlyEmi: number; // incl. GST
  emiExGst: number; // pre-tax salary deduction / month
  postTaxEmi: number;
  tenureMonths: number;
  totalDeduction: number; // emiExGst × tenure
  effectivePrice: number;
  withinLimit: boolean;
  quote: SeppQuote;
}

// The shopper's Smart-EPP entitlement (profile.sepp).
export interface SeppProfile {
  enabled: boolean;
  leasingCompany: string;
  tenureMonths: number;
  adldPct: number;
  incomeTaxPct: number;
  advanceFeeType: 'FIXED' | 'PERCENT';
  advanceFeeValue: number;
  limit: number;
  reserved: number;
  consumed: number;
  available: number;
  branches: SeppBranch[];
}

// A company office branch — the only allowed delivery point for a lease order.
export interface SeppBranch {
  id: string;
  label: string | null;
  contactName: string;
  contactPhone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}

export interface SeppCartQuoteLine {
  itemId: string;
  productId: string;
  name: string;
  brand: string;
  group: string;
  image: string | null;
  qty: number;
  assetCost: number;
  monthlyEmi: number;
  emiExGst: number;
  lineMonthlyEmi: number;
  lineTotalDeduction: number;
}

export interface SeppCartQuote {
  lines: SeppCartQuoteLine[];
  quote: SeppQuote;
  advance: number;
  hasPhone: boolean;
  withinLimit: boolean;
  limit: number;
  available: number;
  leasingCompany: string;
  branches: SeppBranch[];
  canSubmit: boolean;
  issues: string[];
}

export type SeppStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'HR_APPROVED'
  | 'LEASING_APPROVED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'ORDERED';

export interface SeppApproval {
  stage: 'HR' | 'LEASING';
  sequence: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approver: string | null;
  comments: string | null;
  decidedAt: string | null;
}

export interface SeppInstallment {
  installmentNo: number;
  dueDate: string;
  amount: number;
  paidAt: string | null;
}

export interface SeppRequestView {
  id: string;
  requestNo: string;
  status: SeppStatus;
  employee: {
    id: string;
    name: string;
    email: string;
    employeeCode: string;
    department: string | null;
    monthlySalary: number;
  };
  company: { id: string; name: string };
  address: Omit<SeppBranch, 'isDefault'>;
  quote: SeppQuote | null;
  totalAmount: number;
  advanceAmount: number;
  advancePaidAt: string | null;
  advanceRefundedAt: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  checkoutGroup: string | null;
  items: {
    productId: string;
    name: string;
    brand: string;
    sku: string;
    group: string;
    image: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
  approvals: SeppApproval[];
  leaseTerms: {
    leasingCompany: string;
    tenureMonths: number;
    emiAmount: number;
    downPayment: number;
    financedAmount: number;
    installments: SeppInstallment[];
  } | null;
  orders: { orderNo: string; status: string }[];
  createdAt: string;
  updatedAt: string;
}

// Status → human label + pill tone, shared by every portal.
export const SEPP_STATUS_LABEL: Record<SeppStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Pending HR approval',
  HR_APPROVED: 'Pending leasing approval',
  LEASING_APPROVED: 'Approved',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  ORDERED: 'Order placed',
};
export const SEPP_STATUS_TONE: Record<SeppStatus, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  DRAFT: 'neutral',
  SUBMITTED: 'warning',
  HR_APPROVED: 'info',
  LEASING_APPROVED: 'success',
  APPROVED: 'success',
  REJECTED: 'error',
  CANCELLED: 'error',
  ORDERED: 'success',
};

// Timeline steps for a request; `current` = completed count (1-indexed).
export const SEPP_TIMELINE_STEPS = ['Submitted', 'HR approval', 'Leasing approval', 'Order placed'];
export function seppTimelineStep(status: SeppStatus): { current: number; cancelled: boolean } {
  switch (status) {
    case 'SUBMITTED':
      return { current: 1, cancelled: false };
    case 'HR_APPROVED':
      return { current: 2, cancelled: false };
    case 'LEASING_APPROVED':
    case 'APPROVED':
      return { current: 3, cancelled: false };
    case 'ORDERED':
      return { current: 4, cancelled: false };
    case 'REJECTED':
    case 'CANCELLED':
      return { current: 1, cancelled: true };
    default:
      return { current: 0, cancelled: false };
  }
}
