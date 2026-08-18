/**
 * Test-data generator — populates the DB with a realistic cross-section for
 * demoing the Super Admin portal (companies, employees, catalog, coupons,
 * orders + shipments). Idempotent: keyed on stable ids / natural unique fields,
 * safe to re-run. This is DEMO data — separate from the canonical `seed.ts`.
 *
 *   npx ts-node prisma/test-data.ts
 */
import {
  PrismaClient,
  Role,
  Prisma,
  PriceType,
  ProductStatus,
  OrderType,
  OrderStatus,
  AddressType,
  ShipmentStatus,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const D = (n: number) => new Prisma.Decimal(n);

// Deterministic id helper so re-runs upsert the same rows.
const id = (p: string, n: string | number) => `seed-${p}-${n}`;

async function main() {
  const pw = await bcrypt.hash('imcorp@2026', 10);

  // ── Categories ─────────────────────────────────────────────────────────────
  const categories = [
    { slug: 'phones', name: 'Phones' },
    { slug: 'accessories', name: 'Accessories' },
    { slug: 'bags', name: 'Bags' },
  ];
  for (const c of categories) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      update: {},
      create: { id: id('cat', c.slug), name: c.name, slug: c.slug },
    });
  }
  const catId = (slug: string) => id('cat', slug);

  // ── Companies (+ admin users) ──────────────────────────────────────────────
  // emailDomain lets employees self-register on that domain and auto-join.
  const companies = [
    { key: 'nexus', name: 'Nexus Systems', gstin: '27AABCN1234A1Z5', status: 'ACTIVE' as const, domain: 'nexus.com', sepp: false },
    { key: 'acme', name: 'Acme Corp', gstin: '29AABCA5678B1Z2', status: 'ACTIVE' as const, domain: 'acme.com', sepp: true },
    { key: 'orbit', name: 'Orbit Financial', gstin: '07AABCO9012C1Z8', status: 'ACTIVE' as const, domain: 'orbit.com', sepp: true },
    { key: 'zenith', name: 'Zenith Retail', gstin: '19AABCZ3456D1Z1', status: 'SUSPENDED' as const, domain: 'zenith.com', sepp: false },
    { key: 'vertex', name: 'Vertex Health', gstin: '33AABCV7890E1Z4', status: 'ACTIVE' as const, domain: 'vertex.com', sepp: false },
  ];
  for (const co of companies) {
    const adminUser = await prisma.user.upsert({
      where: { email: `admin@${co.key}.com` },
      update: { passwordHash: pw },
      create: {
        id: id('user-coadmin', co.key),
        email: `admin@${co.key}.com`,
        fullName: `${co.name} Admin`,
        role: Role.COMPANY_ADMIN,
        status: 'ACTIVE',
        passwordHash: pw,
      },
    });
    // Each company gets its own credit policy (Company.creditPolicyId is unique).
    await prisma.creditPolicy.upsert({
      where: { id: id('policy', co.key) },
      update: {},
      create: {
        id: id('policy', co.key),
        name: `${co.name} — Revolving (1× salary)`,
        model: 'REVOLVING',
        period: 'MONTHLY',
        salaryMultiplier: D(1),
      },
    });
    await prisma.company.upsert({
      where: { id: id('company', co.key) },
      update: { status: co.status, emailDomain: co.domain, smartEppEnabled: co.sepp },
      create: {
        id: id('company', co.key),
        name: co.name,
        gstin: co.gstin,
        emailDomain: co.domain,
        status: co.status,
        smartEppEnabled: co.sepp,
        adminUserId: adminUser.id,
        creditPolicyId: id('policy', co.key),
      },
    });
  }

  // ── Employees (+ user accounts) ────────────────────────────────────────────
  const employees = [
    { key: 'rohan', name: 'Rohan Mehta', email: 'rohan.m@acme.com', company: 'acme', code: 'ACM-001', dept: 'Engineering', salary: 180000 },
    { key: 'sara', name: 'Sara Iyer', email: 'sara.i@nexus.com', company: 'nexus', code: 'NEX-014', dept: 'Design', salary: 150000 },
    { key: 'neha', name: 'Neha Kapoor', email: 'neha.k@orbit.com', company: 'orbit', code: 'ORB-102', dept: 'Finance', salary: 210000 },
    { key: 'karan', name: 'Karan Shah', email: 'karan.s@zenith.com', company: 'zenith', code: 'ZEN-045', dept: 'Sales', salary: 120000 },
    { key: 'ananya', name: 'Ananya Rao', email: 'ananya.r@vertex.com', company: 'vertex', code: 'VER-078', dept: 'Operations', salary: 165000 },
  ];
  for (const e of employees) {
    const user = await prisma.user.upsert({
      where: { email: e.email },
      update: { passwordHash: pw },
      create: {
        id: id('user-emp', e.key),
        email: e.email,
        fullName: e.name,
        role: Role.EMPLOYEE_EPP,
        status: 'ACTIVE',
        passwordHash: pw,
      },
    });
    await prisma.employee.upsert({
      where: { id: id('emp', e.key) },
      update: { monthlySalary: D(e.salary), creditLimit: D(e.salary * 12) },
      create: {
        id: id('emp', e.key),
        companyId: id('company', e.company),
        userId: user.id,
        employeeCode: e.code,
        department: e.dept,
        monthlySalary: D(e.salary),
        // HR-set credit limit = annual salary (12× monthly).
        creditLimit: D(e.salary * 12),
      },
    });
  }

  // ── Resellers (+ operator login accounts) ──────────────────────────────────
  // Names must match the frontend Vendor union exactly (shop products map vendor
  // ← reseller.name). Each gets a RESELLER user so the reseller portal can log in.
  const resellers = [
    { key: 'techno', name: 'TechnoReseller', email: 'sales@technoreseller.com' },
    { key: 'mobilehub', name: 'MobileHub', email: 'ops@mobilehub.com' },
    { key: 'gadgetpro', name: 'GadgetPro', email: 'hello@gadgetpro.com' },
    { key: 'urbancarry', name: 'UrbanCarry', email: 'sales@urbancarry.com' },
  ];
  for (const r of resellers) {
    const rUser = await prisma.user.upsert({
      where: { email: r.email },
      update: { passwordHash: pw },
      create: {
        id: id('user-reseller', r.key),
        email: r.email,
        fullName: `${r.name} Operator`,
        role: Role.RESELLER,
        status: 'ACTIVE',
        passwordHash: pw,
      },
    });
    await prisma.reseller.upsert({
      where: { id: id('reseller', r.key) },
      update: { userId: rUser.id },
      create: {
        id: id('reseller', r.key),
        name: r.name,
        contactEmail: r.email,
        status: 'ACTIVE',
        userId: rUser.id,
      },
    });
  }

  // ── Fulfillment partners ───────────────────────────────────────────────────
  const partners = [
    { key: 'swift', name: 'SwiftShip Logistics', email: 'dispatch@swiftship.com' },
    { key: 'metro', name: 'MetroDispatch', email: 'ops@metrodispatch.com' },
    { key: 'prime', name: 'PrimeCarry', email: 'support@primecarry.com' },
  ];
  for (const p of partners) {
    await prisma.fulfillmentPartner.upsert({
      where: { id: id('fp', p.key) },
      update: {},
      create: { id: id('fp', p.key), name: p.name, contactEmail: p.email, status: 'ACTIVE' },
    });
  }

  // ── Products — full storefront catalog (22 SKUs) with presentation ──────────
  // The `specs` JSON blob carries the storefront presentation the schema columns
  // don't (gradient g1/g2, per-shade swatches, spec rows, newness sort key) so
  // the live shop catalog *is* this demo content. Ported from the frontend
  // fixtures (catalog.ts + storefront.ts). Vendor → reseller name; null = house.
  type Shade = { name: string; g1: string; g2: string; stock: number };
  type Spec = { k: string; v: string };
  const phoneSpecs = (chip: string, cam: string, batt: string): Spec[] => [
    { k: 'Display', v: '6.7" OLED · 120Hz' },
    { k: 'Chip', v: chip },
    { k: 'Camera', v: cam },
    { k: 'Battery', v: batt },
    { k: 'In the box', v: 'Device, USB-C cable, SIM tool' },
  ];
  const audioSpecs: Spec[] = [
    { k: 'Type', v: 'In-ear · ANC' },
    { k: 'Battery', v: 'Up to 30h with case' },
    { k: 'Connectivity', v: 'Bluetooth 5.3' },
    { k: 'In the box', v: 'Buds, case, ear tips, cable' },
  ];
  const powerSpecs: Spec[] = [
    { k: 'Output', v: 'USB-C PD' },
    { k: 'Compatibility', v: 'Phones, tablets, laptops' },
    { k: 'In the box', v: 'Adapter, cable' },
  ];
  const bagSpecs: Spec[] = [
    { k: 'Material', v: 'Weatherproof recycled nylon' },
    { k: 'Laptop', v: 'Fits up to 16"' },
    { k: 'Warranty', v: 'Lifetime guarantee' },
  ];
  const titanium: Shade[] = [
    { name: 'Blue Titanium', g1: '#4a7fc0', g2: '#123a72', stock: 20 },
    { name: 'Natural Titanium', g1: '#c8c2b6', g2: '#8a8378', stock: 12 },
    { name: 'White Titanium', g1: '#eef0f2', g2: '#c9ccd2', stock: 8 },
    { name: 'Black Titanium', g1: '#3a3f47', g2: '#111417', stock: 8 },
  ];
  const galaxyShades: Shade[] = [
    { name: 'Titanium Black', g1: '#2b2f36', g2: '#0b0d10', stock: 18 },
    { name: 'Titanium Violet', g1: '#6b5aa0', g2: '#2f2652', stock: 9 },
    { name: 'Titanium Gray', g1: '#7d8794', g2: '#3d434c', stock: 5 },
  ];
  const opShades: Shade[] = [
    { name: 'Flowy Emerald', g1: '#1f6f52', g2: '#0a2f22', stock: 30 },
    { name: 'Silky Black', g1: '#2b2f36', g2: '#0b0d10', stock: 30 },
  ];

  interface ProdSeed {
    key: string;
    sku: string;
    name: string;
    brand: string;
    cat: string;
    sub: string;
    vendor: string | null;
    price: number;
    mrp: number;
    stock: number;
    status: ProductStatus;
    g1: string;
    g2: string;
    rating: number;
    reviews: number;
    desc: string;
    freebie?: string;
    shades?: Shade[];
    specs: Spec[];
    familyKey?: string;
    optionColor?: string;
    optionVariant?: string;
  }

  const products: ProdSeed[] = [
    { key: 'p1', sku: 'IMC-AP-1509', name: 'iPhone 15 Pro · 256GB', brand: 'Apple', cat: 'phones', sub: 'flagship', vendor: null, price: 124900, mrp: 134900, stock: 48, status: ProductStatus.ACTIVE, g1: '#4a7fc0', g2: '#123a72', rating: 4.8, reviews: 2140, desc: 'Titanium design with the A17 Pro chip, a 48MP main camera, and all-day battery.', freebie: 'Free silicone case + tempered glass', shades: titanium, specs: phoneSpecs('A17 Pro', '48MP main · 3× telephoto', 'Up to 23h video') },
    { key: 'p2', sku: 'TR-SS-2401', name: 'Galaxy S24 Ultra · 512GB', brand: 'Samsung', cat: 'phones', sub: 'flagship', vendor: 'techno', price: 129999, mrp: 139999, stock: 32, status: ProductStatus.ACTIVE, g1: '#2b2f36', g2: '#0b0d10', rating: 4.7, reviews: 1620, desc: 'The ultimate Galaxy — S Pen, 200MP camera and a titanium frame.', shades: galaxyShades, specs: phoneSpecs('Snapdragon 8 Gen 3', '200MP main · 5× periscope', 'Up to 30h video') },
    { key: 'p3', sku: 'IMC-OP-1200', name: 'OnePlus 12 · 256GB', brand: 'OnePlus', cat: 'phones', sub: 'flagship', vendor: null, price: 64999, mrp: 69999, stock: 60, status: ProductStatus.ACTIVE, g1: '#1f6f52', g2: '#0a2f22', rating: 4.6, reviews: 980, desc: 'Flagship performance with Hasselblad cameras and 100W fast charging.', freebie: 'Free 80W charger + protective case', shades: opShades, specs: phoneSpecs('Snapdragon 8 Gen 3', '50MP Hasselblad triple', '5400mAh · 100W') },
    { key: 'p4', sku: 'IMC-GP-0812', name: 'Pixel 8 Pro · 128GB', brand: 'Google', cat: 'phones', sub: 'flagship', vendor: null, price: 84999, mrp: 89999, stock: 24, status: ProductStatus.ACTIVE, g1: '#7a8fae', g2: '#3a465c', rating: 4.5, reviews: 740, desc: 'Google Tensor G3, the best of Google AI, and a pro-grade camera.', freebie: 'Free Pixel Buds A-Series', specs: phoneSpecs('Google Tensor G3', '50MP · 5× optical', 'Up to 24h · 27W') },
    { key: 'p5', sku: 'TR-SS-5501', name: 'Galaxy A55 5G · 128GB', brand: 'Samsung', cat: 'phones', sub: 'mid', vendor: 'techno', price: 39999, mrp: 42999, stock: 90, status: ProductStatus.ACTIVE, g1: '#c8a24a', g2: '#7a5f1e', rating: 4.3, reviews: 1310, desc: 'Premium mid-range with a vivid AMOLED display and all-day battery.', specs: phoneSpecs('Exynos 1480', '50MP OIS triple', '5000mAh · 25W') },
    { key: 'p6', sku: 'MH-NT-2A00', name: 'Nothing Phone (2a)', brand: 'Nothing', cat: 'phones', sub: 'mid', vendor: 'mobilehub', price: 27999, mrp: 29999, stock: 75, status: ProductStatus.ACTIVE, g1: '#e6e8ec', g2: '#b6bcc6', rating: 4.4, reviews: 890, desc: 'Glyph Interface, clean design, and dependable performance.', freebie: 'Free clear case', specs: phoneSpecs('Dimensity 7200 Pro', '50MP dual', '5000mAh · 45W') },
    { key: 'p7', sku: 'TR-VV-1000', name: 'Vivo X100 Pro', brand: 'Vivo', cat: 'phones', sub: 'flagship', vendor: 'techno', price: 89999, mrp: 94999, stock: 0, status: ProductStatus.INACTIVE, g1: '#3a2f5a', g2: '#171029', rating: 4.5, reviews: 410, desc: 'ZEISS optics and a 1-inch main sensor for pro-grade photography.', specs: phoneSpecs('Dimensity 9300', '50MP 1-inch ZEISS', '5400mAh · 100W') },
    { key: 'p8', sku: 'MH-XM-1300', name: 'Redmi Note 13 Pro', brand: 'Xiaomi', cat: 'phones', sub: 'budget', vendor: 'mobilehub', price: 24999, mrp: 26999, stock: 140, status: ProductStatus.DRAFT, g1: '#4a5670', g2: '#1e2536', rating: 4.2, reviews: 1520, desc: 'Big battery, bright display, and 200MP camera on a budget.', specs: phoneSpecs('Snapdragon 7s Gen 2', '200MP main', '5100mAh · 67W') },

    // ── Variant family demo: realme C100X, two colours × two storage (each a
    //    separate SKU sharing familyKey 'realme-c100x'). The storefront shows it
    //    as one card and the detail page renders colour + storage selectors.
    { key: 'rc1', sku: 'RM-C100X-G64', name: 'realme C100X · Gold · 64GB', brand: 'realme', cat: 'phones', sub: 'budget', vendor: 'mobilehub', price: 12999, mrp: 16999, stock: 60, status: ProductStatus.ACTIVE, g1: '#d8c48a', g2: '#8a6f2e', rating: 4.4, reviews: 610, desc: '6.8-inch 120Hz display, 8000mAh battery, 45W fast charge, 50MP AI camera.', freebie: 'Free protective case', specs: phoneSpecs('Unisoc T7250', '50MP AI dual', '8000mAh · 45W'), familyKey: 'realme-c100x', optionColor: 'Gold', optionVariant: '64GB' },
    { key: 'rc2', sku: 'RM-C100X-G128', name: 'realme C100X · Gold · 128GB', brand: 'realme', cat: 'phones', sub: 'budget', vendor: 'mobilehub', price: 14999, mrp: 18999, stock: 40, status: ProductStatus.ACTIVE, g1: '#d8c48a', g2: '#8a6f2e', rating: 4.4, reviews: 610, desc: '6.8-inch 120Hz display, 8000mAh battery, 45W fast charge, 50MP AI camera.', freebie: 'Free protective case', specs: phoneSpecs('Unisoc T7250', '50MP AI dual', '8000mAh · 45W'), familyKey: 'realme-c100x', optionColor: 'Gold', optionVariant: '128GB' },
    { key: 'rc3', sku: 'RM-C100X-B64', name: 'realme C100X · Blue · 64GB', brand: 'realme', cat: 'phones', sub: 'budget', vendor: 'mobilehub', price: 12999, mrp: 16999, stock: 25, status: ProductStatus.ACTIVE, g1: '#2b4a8f', g2: '#12224a', rating: 4.4, reviews: 610, desc: '6.8-inch 120Hz display, 8000mAh battery, 45W fast charge, 50MP AI camera.', freebie: 'Free protective case', specs: phoneSpecs('Unisoc T7250', '50MP AI dual', '8000mAh · 45W'), familyKey: 'realme-c100x', optionColor: 'Blue', optionVariant: '64GB' },
    { key: 'rc4', sku: 'RM-C100X-B128', name: 'realme C100X · Blue · 128GB', brand: 'realme', cat: 'phones', sub: 'budget', vendor: 'mobilehub', price: 14999, mrp: 18999, stock: 18, status: ProductStatus.ACTIVE, g1: '#2b4a8f', g2: '#12224a', rating: 4.4, reviews: 610, desc: '6.8-inch 120Hz display, 8000mAh battery, 45W fast charge, 50MP AI camera.', freebie: 'Free protective case', specs: phoneSpecs('Unisoc T7250', '50MP AI dual', '8000mAh · 45W'), familyKey: 'realme-c100x', optionColor: 'Blue', optionVariant: '128GB' },

    { key: 'a1', sku: 'IMC-AP-2200', name: 'AirPods Pro (2nd gen)', brand: 'Apple', cat: 'accessories', sub: 'audio', vendor: null, price: 24900, mrp: 26900, stock: 210, status: ProductStatus.ACTIVE, g1: '#f2f3f5', g2: '#c6cad2', rating: 4.8, reviews: 3200, desc: 'Adaptive ANC, personalised spatial audio, and USB-C charging.', freebie: 'Free charging case sleeve', specs: audioSpecs },
    { key: 'a2', sku: 'TR-SS-BD03', name: 'Galaxy Buds3 Pro', brand: 'Samsung', cat: 'accessories', sub: 'audio', vendor: 'techno', price: 18999, mrp: 19999, stock: 130, status: ProductStatus.ACTIVE, g1: '#7d8794', g2: '#3d434c', rating: 4.5, reviews: 1100, desc: 'Galaxy AI-powered earbuds with intelligent ANC.', specs: audioSpecs },
    { key: 'a3', sku: 'GP-AN-0065', name: '65W GaN USB-C Charger', brand: 'Anker', cat: 'accessories', sub: 'power', vendor: 'gadgetpro', price: 3499, mrp: 3999, stock: 120, status: ProductStatus.ACTIVE, g1: '#f2f3f5', g2: '#c6cad2', rating: 4.7, reviews: 640, desc: 'Compact GaN charger with 65W of fast USB-C power.', specs: powerSpecs },
    { key: 'a4', sku: 'TR-SS-2500', name: '25W Super Fast Charger', brand: 'Samsung', cat: 'accessories', sub: 'power', vendor: 'techno', price: 1799, mrp: 1999, stock: 300, status: ProductStatus.ACTIVE, g1: '#e9ebf0', g2: '#cfd3da', rating: 4.4, reviews: 520, desc: '25W super-fast charging in a travel-friendly size.', specs: powerSpecs },
    { key: 'a5', sku: 'GP-AN-1000', name: '10000mAh Power Bank', brand: 'Anker', cat: 'accessories', sub: 'power', vendor: 'gadgetpro', price: 2499, mrp: 2999, stock: 180, status: ProductStatus.ACTIVE, g1: '#2b2f36', g2: '#0b0d10', rating: 4.6, reviews: 880, desc: 'Slim 10000mAh power bank with USB-C in/out.', specs: powerSpecs },
    { key: 'a6', sku: 'TR-SP-2401', name: 'Galaxy S24 Ultra Case', brand: 'Spigen', cat: 'accessories', sub: 'cases', vendor: 'techno', price: 1299, mrp: 1499, stock: 260, status: ProductStatus.ACTIVE, g1: '#3a3f47', g2: '#16191d', rating: 4.3, reviews: 210, desc: 'Rugged protection with military-grade drop resistance.', specs: [{ k: 'Fit', v: 'Galaxy S24 Ultra' }, { k: 'Protection', v: 'MIL-STD 810G' }] },
    { key: 'a7', sku: 'GP-NL-0002', name: 'Tempered Glass (2 pack)', brand: 'Nillkin', cat: 'accessories', sub: 'cases', vendor: 'gadgetpro', price: 599, mrp: 799, stock: 500, status: ProductStatus.ACTIVE, g1: '#dfe3ea', g2: '#b3b9c4', rating: 4.2, reviews: 990, desc: '2.5D tempered glass with oleophobic coating (2 pack).', specs: [{ k: 'Hardness', v: '9H' }, { k: 'Pack', v: '2 sheets + wipes' }] },
    { key: 'a8', sku: 'IMC-AP-0100', name: 'USB-C to Lightning Cable', brand: 'Apple', cat: 'accessories', sub: 'power', vendor: null, price: 1900, mrp: 2200, stock: 0, status: ProductStatus.DRAFT, g1: '#eceef1', g2: '#c9ced6', rating: 4.6, reviews: 430, desc: 'Braided USB-C to Lightning cable, 1m, fast-charge ready.', specs: powerSpecs },

    { key: 'b1', sku: 'UC-PD-0020', name: 'Everyday Backpack 20L', brand: 'Peak Design', cat: 'bags', sub: 'backpacks', vendor: 'urbancarry', price: 18999, mrp: 21999, stock: 64, status: ProductStatus.ACTIVE, g1: '#6a5240', g2: '#332417', rating: 4.9, reviews: 560, desc: 'Weatherproof everyday carry with the signature MagLatch.', freebie: 'Free rain cover', specs: bagSpecs },
    { key: 'b2', sku: 'UC-TT-1400', name: 'Slim Laptop Sleeve 14"', brand: 'tomtoc', cat: 'bags', sub: 'sleeves', vendor: 'urbancarry', price: 2499, mrp: 2999, stock: 150, status: ProductStatus.ACTIVE, g1: '#3a3f47', g2: '#16191d', rating: 4.5, reviews: 320, desc: 'Slim, padded sleeve with a soft-touch interior.', specs: bagSpecs },
    { key: 'b3', sku: 'UC-ND-0001', name: 'Executive Briefcase', brand: 'Nappa Dori', cat: 'bags', sub: 'briefcases', vendor: 'urbancarry', price: 12999, mrp: 15999, stock: 40, status: ProductStatus.ACTIVE, g1: '#5a3d2b', g2: '#2a1a10', rating: 4.6, reviews: 180, desc: 'Full-grain leather briefcase for the modern professional.', specs: bagSpecs },
    { key: 'b4', sku: 'UC-WC-0025', name: 'Commuter Backpack 25L', brand: 'Wildcraft', cat: 'bags', sub: 'backpacks', vendor: 'urbancarry', price: 4999, mrp: 5999, stock: 110, status: ProductStatus.ACTIVE, g1: '#2f3a44', g2: '#121a22', rating: 4.3, reviews: 410, desc: 'Spacious 25L commuter backpack with a dedicated laptop bay.', specs: bagSpecs },
    { key: 'b5', sku: 'UC-ND-0002', name: 'Leather Portfolio Case', brand: 'Nappa Dori', cat: 'bags', sub: 'briefcases', vendor: 'urbancarry', price: 6999, mrp: 7999, stock: 55, status: ProductStatus.DRAFT, g1: '#7a5a3a', g2: '#3a2817', rating: 4.4, reviews: 140, desc: 'Handcrafted leather portfolio for documents and a tablet.', specs: bagSpecs },
    { key: 'b6', sku: 'UC-BG-0003', name: 'Canvas Messenger Bag', brand: 'Baggit', cat: 'bags', sub: 'briefcases', vendor: 'urbancarry', price: 3499, mrp: 3999, stock: 0, status: ProductStatus.INACTIVE, g1: '#4a4636', g2: '#22201a', rating: 4.1, reviews: 260, desc: 'Durable canvas messenger with an adjustable strap.', specs: bagSpecs },
  ];

  const smartOf = (epp: number) => Math.round(epp * 1.03);
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const presentation = {
      g1: p.g1,
      g2: p.g2,
      newness: products.length - i,
      shades: p.shades ?? [],
      rows: p.specs,
    };
    const prod = await prisma.product.upsert({
      where: { sku: p.sku },
      update: {
        status: p.status,
        resellerId: p.vendor ? id('reseller', p.vendor) : null,
        mrp: D(p.mrp),
        rating: p.rating,
        reviewCount: p.reviews,
        description: p.desc,
        freebieText: p.freebie ?? null,
        colorOptions: p.shades?.length ? p.shades.map((s) => s.name).join(', ') : null,
        specs: presentation,
        familyKey: p.familyKey ?? null,
        optionColor: p.optionColor ?? null,
        optionVariant: p.optionVariant ?? null,
      },
      create: {
        id: id('prod', p.key),
        sku: p.sku,
        name: p.name,
        brand: p.brand,
        categoryId: catId(p.cat),
        subCategory: p.sub,
        status: p.status,
        resellerId: p.vendor ? id('reseller', p.vendor) : null,
        mrp: D(p.mrp),
        rating: p.rating,
        reviewCount: p.reviews,
        description: p.desc,
        freebieText: p.freebie ?? null,
        colorOptions: p.shades?.length ? p.shades.map((s) => s.name).join(', ') : null,
        specs: presentation,
        familyKey: p.familyKey ?? null,
        optionColor: p.optionColor ?? null,
        optionVariant: p.optionVariant ?? null,
        inventory: { create: { quantity: p.stock } },
        prices: {
          create: [
            { priceType: PriceType.EPP, mrp: D(p.mrp), sellingPrice: D(p.price) },
            { priceType: PriceType.SMART_EPP, mrp: D(p.mrp), sellingPrice: D(smartOf(p.price)) },
          ],
        },
      },
    });

    // Marketplace offer (source of truth for storefront price + stock). Mirrors
    // the legacy price/inventory above so re-running this generator stays valid.
    // The compound unique [productId, resellerId] can't be used in an upsert when
    // resellerId is null, so find-then-write.
    const offerResellerId = p.vendor ? id('reseller', p.vendor) : null;
    const offerData = {
      eppPrice: D(p.price),
      smartEppPrice: D(smartOf(p.price)),
      quantity: p.stock,
      status: p.status,
      isActive: p.status === ProductStatus.ACTIVE,
    };
    const existingOffer = await prisma.productOffer.findFirst({
      where: { productId: prod.id, resellerId: offerResellerId },
      select: { id: true },
    });
    if (existingOffer) {
      await prisma.productOffer.update({ where: { id: existingOffer.id }, data: offerData });
    } else {
      await prisma.productOffer.create({
        data: { productId: prod.id, resellerId: offerResellerId, ...offerData },
      });
    }
  }

  // Resolve real product ids by SKU (upsert-by-sku means pre-existing rows keep
  // their original ids, so we can't assume id('prod', key)).
  const skuOf = new Map(products.map((p) => [p.key, p.sku]));
  const dbProducts = await prisma.product.findMany({ select: { id: true, sku: true } });
  const prodIdBySku = new Map(dbProducts.map((p) => [p.sku, p.id]));
  const prodId = (key: string) => prodIdBySku.get(skuOf.get(key)!)!;

  // ── Coupons (a couple more alongside the base seed) ─────────────────────────
  const coupons = [
    { code: 'EPP15', type: 'PERCENT' as const, value: 15, maxDiscount: 8000, minOrderValue: 40000, status: 'ACTIVE' as const, used: 148, limit: 1000, cat: 'phones' },
    { code: 'BAGS20', type: 'PERCENT' as const, value: 20, maxDiscount: 4000, minOrderValue: 0, status: 'ACTIVE' as const, used: 74, limit: 800, cat: 'bags' },
    { code: 'AUDIO10', type: 'PERCENT' as const, value: 10, maxDiscount: 2000, minOrderValue: 0, status: 'SCHEDULED' as const, used: 0, limit: 1200, cat: 'accessories' },
  ];
  for (const c of coupons) {
    await prisma.coupon.upsert({
      where: { code: c.code },
      update: {},
      create: {
        code: c.code,
        type: c.type,
        value: D(c.value),
        maxDiscount: c.maxDiscount ? D(c.maxDiscount) : null,
        minOrderValue: D(c.minOrderValue),
        status: c.status,
        usedCount: c.used,
        usageLimit: c.limit,
        categoryId: catId(c.cat),
      },
    });
  }

  // ── Addresses (one per employee) ───────────────────────────────────────────
  for (const e of employees) {
    await prisma.address.upsert({
      where: { id: id('addr', e.key) },
      update: {},
      create: {
        id: id('addr', e.key),
        type: AddressType.OFFICE,
        employeeId: id('emp', e.key),
        contactName: e.name,
        contactPhone: '9800000000',
        line1: '1 Corporate Park',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        isDefault: true,
      },
    });
  }

  // ── Orders (spread across statuses + companies for the dashboard) ───────────
  // GST is 18% of subtotal for demo purposes.
  const orders = [
    { key: '20492', emp: 'sara', company: 'nexus', product: 'p1', qty: 1, status: 'PLACED' as const, partner: 'swift', daysAgo: 1 },
    { key: '20489', emp: 'rohan', company: 'acme', product: 'p3', qty: 1, status: 'CONFIRMED' as const, partner: 'metro', daysAgo: 1 },
    { key: '20485', emp: 'neha', company: 'orbit', product: 'p2', qty: 2, status: 'DISPATCHED' as const, partner: 'swift', daysAgo: 3 },
    { key: '20478', emp: 'karan', company: 'zenith', product: 'a1', qty: 1, status: 'DELIVERED' as const, partner: 'metro', daysAgo: 6 },
    { key: '20470', emp: 'ananya', company: 'vertex', product: 'b1', qty: 1, status: 'DELIVERED' as const, partner: 'swift', daysAgo: 8 },
    { key: '20465', emp: 'rohan', company: 'acme', product: 'p6', qty: 1, status: 'CANCELLED' as const, partner: null, daysAgo: 10 },
    { key: '20460', emp: 'sara', company: 'nexus', product: 'a2', qty: 2, status: 'DELIVERED' as const, partner: 'prime', daysAgo: 12 },
    { key: '20455', emp: 'neha', company: 'orbit', product: 'p4', qty: 1, status: 'PLACED' as const, partner: null, daysAgo: 2 },
    // Extra TechnoReseller orders (product vendor 'techno') with shipments so the
    // reseller can drive transit updates end-to-end.
    { key: '20500', emp: 'sara', company: 'nexus', product: 'p5', qty: 1, status: 'PLACED' as const, partner: 'swift', daysAgo: 1 },
    { key: '20501', emp: 'rohan', company: 'acme', product: 'a4', qty: 2, status: 'CONFIRMED' as const, partner: 'metro', daysAgo: 2 },
    { key: '20502', emp: 'neha', company: 'orbit', product: 'a6', qty: 1, status: 'DISPATCHED' as const, partner: 'prime', daysAgo: 4 },
  ];

  // Resolve EPP selling prices + reseller attribution for order math.
  const priceOf = new Map<string, number>();
  const vendorOf = new Map<string, string | null>();
  for (const p of products) {
    priceOf.set(p.key, p.price);
    vendorOf.set(p.key, p.vendor);
  }

  const now = Date.now();
  for (const o of orders) {
    const unit = priceOf.get(o.product)!;
    const subtotal = unit * o.qty;
    const gst = Math.round(subtotal * 0.18 * 100) / 100;
    const total = subtotal + gst;
    const createdAt = new Date(now - o.daysAgo * 86_400_000);
    const vendorKey = vendorOf.get(o.product) ?? null;
    const resellerId = vendorKey ? id('reseller', vendorKey) : null;

    await prisma.order.upsert({
      where: { orderNo: `IMC-${o.key}` },
      update: { resellerId },
      create: {
        id: id('order', o.key),
        orderNo: `IMC-${o.key}`,
        type: OrderType.EPP,
        employeeId: id('emp', o.emp),
        companyId: id('company', o.company),
        addressId: id('addr', o.emp),
        resellerId,
        subtotal: D(subtotal),
        gst: D(gst),
        total: D(total),
        status: o.status,
        createdAt,
        items: {
          create: [
            {
              productId: prodId(o.product),
              quantity: o.qty,
              unitPrice: D(unit),
              lineTotal: D(subtotal),
            },
          ],
        },
        statusHistory: { create: [{ status: o.status, createdAt }] },
        ...(o.partner
          ? {
              shipment: {
                create: {
                  fulfillmentPartnerId: id('fp', o.partner),
                  status:
                    o.status === 'DELIVERED'
                      ? ShipmentStatus.DELIVERED
                      : o.status === 'DISPATCHED'
                        ? ShipmentStatus.IN_TRANSIT
                        : ShipmentStatus.PENDING,
                  awbNumber: `AWB${o.key}`,
                },
              },
            }
          : {}),
      },
    });
  }

  // ── Wishlist (drives "most wishlisted" analytics) ──────────────────────────
  const wishes = [
    { emp: 'sara', product: 'p1' },
    { emp: 'rohan', product: 'p1' },
    { emp: 'neha', product: 'p1' },
    { emp: 'karan', product: 'p2' },
    { emp: 'ananya', product: 'p2' },
    { emp: 'sara', product: 'a1' },
    { emp: 'rohan', product: 'b1' },
    { emp: 'rohan', product: 'p3' },
  ];
  for (const w of wishes) {
    await prisma.wishlistItem.upsert({
      where: { employeeId_productId: { employeeId: id('emp', w.emp), productId: prodId(w.product) } },
      update: {},
      create: { employeeId: id('emp', w.emp), productId: prodId(w.product) },
    });
  }

  const counts = await prisma.$transaction([
    prisma.company.count(),
    prisma.employee.count(),
    prisma.product.count(),
    prisma.coupon.count(),
    prisma.order.count(),
    prisma.reseller.count(),
    prisma.fulfillmentPartner.count(),
    prisma.wishlistItem.count(),
  ]);
  console.log('Test data ready:', {
    companies: counts[0],
    employees: counts[1],
    products: counts[2],
    coupons: counts[3],
    orders: counts[4],
    resellers: counts[5],
    partners: counts[6],
    wishlist: counts[7],
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
