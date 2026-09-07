/**
 * Standalone demo-user seed — inserts ONLY the view-only storefront demo account
 * (demo@imcorpcart.com) plus a minimal ACTIVE company to satisfy the login gates.
 * Use this on a server where you want the demo login to work WITHOUT importing the
 * full `test-data.ts` demo dataset.
 *
 * The account is an ACTIVE EMPLOYEE_EPP under an ACTIVE company, flagged viewOnly
 * (browse/cart/wishlist work; checkout is blocked). It's one of the hardcoded
 * DEMO_LOGIN_EMAILS (config/constants.ts) that skip email-OTP and sign in directly.
 *
 * Idempotent (stable ids / unique email) — safe to re-run.
 *
 *   npx ts-node prisma/seed-demo-user.ts
 */
import { PrismaClient, Role, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const D = (n: number) => new Prisma.Decimal(n);

// Stable ids so re-runs upsert the same rows (mirrors test-data.ts convention).
const COMPANY_ID = 'seed-company-demo';
const EMPLOYEE_ID = 'seed-emp-demo';
const DEMO_EMAIL = 'demo@imcorpcart.com';

async function main() {
  // Minimal ACTIVE company — the login company-approval gate requires the demo
  // employee's company to be ACTIVE. No admin / credit policy / GSTIN needed.
  await prisma.company.upsert({
    where: { id: COMPANY_ID },
    update: { status: 'ACTIVE' },
    create: {
      id: COMPANY_ID,
      name: 'Demo Company',
      status: 'ACTIVE',
    },
  });

  // View-only demo shopper. Passwordless (no passwordHash) — signs in via the
  // hardcoded DEMO_LOGIN_EMAILS bypass. viewOnly=true blocks checkout server-side.
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { status: 'ACTIVE', role: Role.EMPLOYEE_EPP, viewOnly: true },
    create: {
      email: DEMO_EMAIL,
      fullName: 'Demo Account',
      role: Role.EMPLOYEE_EPP,
      status: 'ACTIVE',
      viewOnly: true,
    },
  });

  await prisma.employee.upsert({
    where: { id: EMPLOYEE_ID },
    update: { companyId: COMPANY_ID },
    create: {
      id: EMPLOYEE_ID,
      companyId: COMPANY_ID,
      userId: user.id,
      employeeCode: 'DEMO-001',
      department: 'Demo',
      monthlySalary: D(0),
      creditLimit: D(0),
    },
  });

  console.log(`✓ demo account ready — ${DEMO_EMAIL} (view-only EMPLOYEE_EPP under "Demo Company")`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
