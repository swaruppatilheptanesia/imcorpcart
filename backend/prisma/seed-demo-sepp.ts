/**
 * Standalone Smart-EPP demo seed — wires the imcorpcart.com demo set into one
 * end-to-end Smart EPP chain WITHOUT importing the full `test-data.ts` dataset:
 *
 *   employee@imcorpcart.com  EMPLOYEE  "Demo Company"      → /shop   (can buy / request)
 *   demo@imcorpcart.com      EMPLOYEE  "Demo Company"      → /shop   (view-only, browse SEPP)
 *   hr@imcorpcart.com        HR ADMIN  "Demo Company"      → /company (stage-1 approval, EMI paid)
 *   leasing@imcorpcart.com   LEASER    "Demo Leasing Partner" → /leasing (stage-2 approval → orders)
 *   reseller@imcorpcart.com  RESELLER  "Demo Reseller"     → /reseller (fulfils the demo phone)
 *
 * Every one of these is a DEMO_LOGIN_EMAILS entry (config/constants.ts) → signs
 * in directly, no OTP. Demo Company gets Smart EPP enabled with the demo leasing
 * company attached (ADLD 2%, 30% slab), two office branches, and the Demo
 * Reseller lists a phone with a Smart-EPP price so the whole chain — request →
 * HR → leasing → order to the reseller → EMI paid → limit restored — is demoable.
 *
 * Idempotent (stable ids / unique emails / skus) — safe to re-run. Runs after
 * (or instead of) seed-demo-user.ts / seed-demo-reseller.ts — it upserts the
 * rows those scripts own with the same ids.
 *
 *   npx ts-node prisma/seed-demo-sepp.ts      (or: npm run db:seed-demo-sepp)
 */
import { PrismaClient, Role, Prisma, ProductStatus, AddressType } from '@prisma/client';

const prisma = new PrismaClient();
const D = (n: number) => new Prisma.Decimal(n);

// Stable ids (shared with seed-demo-user.ts / seed-demo-reseller.ts where they overlap).
const COMPANY_ID = 'seed-company-demo';
const VIEW_ONLY_EMP_ID = 'seed-emp-demo';
const LEASING_ID = 'seed-leasing-demo';
const RESELLER_ID = 'seed-reseller-demo';
const RESELLER_USER_ID = 'seed-user-reseller-demo';

const EMAILS = {
  viewOnly: 'demo@imcorpcart.com',
  employee: 'employee@imcorpcart.com',
  hr: 'hr@imcorpcart.com',
  leasing: 'leasing@imcorpcart.com',
  reseller: 'reseller@imcorpcart.com',
};

const EMPLOYEE_SALARY = 100_000; // ₹/month → Smart EPP purchase limit = 12× = ₹12,00,000
const VIEW_ONLY_SALARY = 80_000;

async function main() {
  // ── Leasing company + operator ─────────────────────────────────────────────
  const leasingUser = await prisma.user.upsert({
    where: { email: EMAILS.leasing },
    update: { role: Role.LEASING_COMPANY, status: 'ACTIVE', viewOnly: false },
    create: {
      id: 'seed-user-leasing-demo',
      email: EMAILS.leasing,
      fullName: 'Demo Leasing Operator',
      role: Role.LEASING_COMPANY,
      status: 'ACTIVE',
    },
  });
  await prisma.leasingCompany.upsert({
    where: { id: LEASING_ID },
    update: { userId: leasingUser.id, status: 'ACTIVE', contactEmail: EMAILS.leasing },
    create: {
      id: LEASING_ID,
      name: 'Demo Leasing Partner',
      contactEmail: EMAILS.leasing,
      contactPhone: '9800000100',
      status: 'ACTIVE',
      userId: leasingUser.id,
      // The client's Financial Illustration parameters; a small fixed advance so
      // the Razorpay (test-mode) step is exercised in the demo.
      ptpm: D(89.5),
      defaultTenureMonths: 12,
      repurchasePct: D(2),
      pvDiscountLeasePct: D(5.21),
      pvDiscountRepurchasePct: D(9.1),
      advanceFeeType: 'FIXED',
      advanceFeeValue: D(499),
    },
  });

  // ── HR admin ───────────────────────────────────────────────────────────────
  const hrUser = await prisma.user.upsert({
    where: { email: EMAILS.hr },
    update: { role: Role.COMPANY_ADMIN, status: 'ACTIVE', viewOnly: false },
    create: {
      id: 'seed-user-coadmin-demo',
      email: EMAILS.hr,
      fullName: 'Demo HR Admin',
      role: Role.COMPANY_ADMIN,
      status: 'ACTIVE',
    },
  });

  // ── Company: Smart EPP on, demo leasing company attached ───────────────────
  await prisma.company.upsert({
    where: { id: COMPANY_ID },
    update: {
      status: 'ACTIVE',
      adminUserId: hrUser.id,
      smartEppEnabled: true,
      leasingCompanyId: LEASING_ID,
      adldPct: D(2),
      incomeTaxPct: D(30),
    },
    create: {
      id: COMPANY_ID,
      name: 'Demo Company',
      status: 'ACTIVE',
      adminUserId: hrUser.id,
      smartEppEnabled: true,
      leasingCompanyId: LEASING_ID,
      adldPct: D(2),
      incomeTaxPct: D(30),
    },
  });

  // ── Office branches (the only Smart-EPP delivery points) ───────────────────
  const branches = [
    { id: 'seed-branch-demo-hq', label: 'Head office', line1: 'Level 4, Demo Tower', line2: 'Bandra Kurla Complex', city: 'Mumbai', state: 'Maharashtra', pincode: '400051', isDefault: true },
    { id: 'seed-branch-demo-blr', label: 'Bengaluru office', line1: '2nd Floor, Demo Tech Park', line2: 'Outer Ring Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560103', isDefault: false },
  ];
  for (const b of branches) {
    await prisma.address.upsert({
      where: { id: b.id },
      update: { companyId: COMPANY_ID, employeeId: null, label: b.label, isDefault: b.isDefault },
      create: {
        id: b.id,
        type: AddressType.OFFICE,
        companyId: COMPANY_ID,
        label: b.label,
        contactName: 'Demo HR Admin',
        contactPhone: '9800000101',
        line1: b.line1,
        line2: b.line2,
        city: b.city,
        state: b.state,
        pincode: b.pincode,
        isDefault: b.isDefault,
      },
    });
  }

  // ── Employees ──────────────────────────────────────────────────────────────
  // Full-function shopper who can place EPP orders and Smart EPP requests.
  const employeeUser = await prisma.user.upsert({
    where: { email: EMAILS.employee },
    update: { role: Role.EMPLOYEE_EPP, status: 'ACTIVE', viewOnly: false },
    create: {
      id: 'seed-user-emp-demo-buyer',
      email: EMAILS.employee,
      fullName: 'Demo Employee',
      role: Role.EMPLOYEE_EPP,
      status: 'ACTIVE',
      phone: '9800000102',
    },
  });
  await prisma.employee.upsert({
    where: { id: 'seed-emp-demo-buyer' },
    update: { companyId: COMPANY_ID, monthlySalary: D(EMPLOYEE_SALARY), creditLimit: D(EMPLOYEE_SALARY * 12), deletedAt: null },
    create: {
      id: 'seed-emp-demo-buyer',
      companyId: COMPANY_ID,
      userId: employeeUser.id,
      employeeCode: 'DEMO-002',
      department: 'Sales',
      monthlySalary: D(EMPLOYEE_SALARY),
      creditLimit: D(EMPLOYEE_SALARY * 12),
    },
  });
  await prisma.address.upsert({
    where: { id: 'seed-addr-demo-buyer' },
    update: {},
    create: {
      id: 'seed-addr-demo-buyer',
      type: AddressType.HOME,
      employeeId: 'seed-emp-demo-buyer',
      contactName: 'Demo Employee',
      contactPhone: '9800000102',
      line1: '12, Demo Residency',
      line2: 'Powai',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400076',
      isDefault: true,
    },
  });

  // View-only demo shopper (seed-demo-user.ts) — keep it view-only but give it a
  // salary/limit so the Smart EPP toggle, EMI cards and calculator are visible.
  const viewOnlyUser = await prisma.user.upsert({
    where: { email: EMAILS.viewOnly },
    update: { status: 'ACTIVE', role: Role.EMPLOYEE_EPP, viewOnly: true },
    create: { id: 'seed-user-emp-demo', email: EMAILS.viewOnly, fullName: 'Demo Account', role: Role.EMPLOYEE_EPP, status: 'ACTIVE', viewOnly: true },
  });
  await prisma.employee.upsert({
    where: { id: VIEW_ONLY_EMP_ID },
    update: { companyId: COMPANY_ID, monthlySalary: D(VIEW_ONLY_SALARY), creditLimit: D(VIEW_ONLY_SALARY * 12) },
    create: {
      id: VIEW_ONLY_EMP_ID,
      companyId: COMPANY_ID,
      userId: viewOnlyUser.id,
      employeeCode: 'DEMO-001',
      department: 'Demo',
      monthlySalary: D(VIEW_ONLY_SALARY),
      creditLimit: D(VIEW_ONLY_SALARY * 12),
    },
  });

  // ── Demo Reseller + a phone with a Smart-EPP price ─────────────────────────
  const resellerUser = await prisma.user.upsert({
    where: { email: EMAILS.reseller },
    update: { status: 'ACTIVE', role: Role.RESELLER },
    create: { id: RESELLER_USER_ID, email: EMAILS.reseller, fullName: 'Demo Reseller Operator', role: Role.RESELLER, status: 'ACTIVE' },
  });
  const reseller = await prisma.reseller.upsert({
    where: { id: RESELLER_ID },
    update: { userId: resellerUser.id, status: 'ACTIVE' },
    create: { id: RESELLER_ID, name: 'Demo Reseller', contactEmail: EMAILS.reseller, status: 'ACTIVE', commissionPct: D(10), userId: resellerUser.id },
  });
  const phones = await prisma.category.upsert({
    where: { slug: 'phones' },
    update: {},
    create: { id: 'seed-cat-phones', name: 'Phones', slug: 'phones' },
  });
  const phone = {
    sku: 'demo-rsl-phone',
    name: 'Demo Smartphone 5G · 256GB',
    brand: 'Demo Mobile',
    mrp: 34_999,
    mop: 32_999,
    epp: 29_999,
    smartEpp: 29_999,
    resellerPrice: 27_000,
    stock: 50,
  };
  const scalars = {
    name: phone.name,
    brand: phone.brand,
    categoryId: phones.id,
    subCategory: 'mid',
    status: ProductStatus.ACTIVE,
    mrp: D(phone.mrp),
    mop: D(phone.mop),
    gstPercent: D(18),
    resellerId: reseller.id,
    description: 'A dependable 5G phone for the Smart EPP demo — 6.7" AMOLED, 50MP camera, 5000mAh battery.',
    freebieText: 'Free clear case',
    specs: {
      g1: '#3b6fd9',
      g2: '#0f2f6b',
      newness: 'New',
      shades: [{ name: 'Midnight Blue', g1: '#3b6fd9', g2: '#0f2f6b', stock: phone.stock }],
      rows: [
        { k: 'Display', v: '6.7" AMOLED · 120Hz' },
        { k: 'Camera', v: '50MP OIS dual' },
        { k: 'Battery', v: '5000mAh · 67W' },
        { k: 'Storage', v: '256GB · 8GB RAM' },
      ],
    } as Prisma.InputJsonValue,
  };
  const product = await prisma.product.upsert({ where: { sku: phone.sku }, update: scalars, create: { sku: phone.sku, ...scalars } });
  const offerData = {
    eppPrice: D(phone.epp),
    smartEppPrice: D(phone.smartEpp),
    resellerPrice: D(phone.resellerPrice),
    quantity: phone.stock,
    status: ProductStatus.ACTIVE,
    isActive: true,
  };
  const existing = await prisma.productOffer.findFirst({ where: { productId: product.id, resellerId: reseller.id } });
  if (existing) await prisma.productOffer.update({ where: { id: existing.id }, data: offerData });
  else await prisma.productOffer.create({ data: { productId: product.id, resellerId: reseller.id, ...offerData } });

  console.log(
    [
      '✓ Smart EPP demo set ready (all sign in without OTP):',
      `  ${EMAILS.employee}   → /shop      Demo Company employee, limit ₹${(EMPLOYEE_SALARY * 12).toLocaleString('en-IN')}`,
      `  ${EMAILS.viewOnly}       → /shop      view-only (browse Smart EPP, no purchase)`,
      `  ${EMAILS.hr}         → /company   Demo Company HR (approve → mark EMIs paid)`,
      `  ${EMAILS.leasing}    → /leasing   Demo Leasing Partner (PTPM 89.5 · 12 mo · ₹499 advance)`,
      `  ${EMAILS.reseller}   → /reseller  Demo Reseller sells "${phone.name}" (Smart EPP ₹${phone.smartEpp.toLocaleString('en-IN')})`,
      '  Branches: Head office (Mumbai, default), Bengaluru office',
    ].join('\n'),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
