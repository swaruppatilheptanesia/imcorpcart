/**
 * Minimal seed so Phase-1 admin dashboards render against real reference data
 * (spec §2 sequencing note: dashboards populate for real only once P2 flows).
 *
 * Idempotent — safe to re-run. Uses upserts keyed on natural unique fields.
 */
import { PrismaClient, Role, PaymentMethod, CourierCode, CourierPriority, NotificationEvent, NotificationChannel } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // 1. Super Admin operator account (admin-created, no self-registration).
  // Password enables the login -> OTP flow served by the REST API.
  const adminPasswordHash = await bcrypt.hash("imcorp@2026", 10);
  await prisma.user.upsert({
    where: { email: "admin@imcorpcart.local" },
    update: { passwordHash: adminPasswordHash },
    create: {
      email: "admin@imcorpcart.local",
      fullName: "Platform Super Admin",
      role: Role.SUPER_ADMIN,
      status: "ACTIVE",
      twoFactorEnabled: true,
      passwordHash: adminPasswordHash,
    },
  });

  // 2. Payment method surcharge configs (UPI 0 / NetBanking 1 / CC 2 / Debit 1).
  const methodConfigs: { method: PaymentMethod; surchargePercent: number }[] = [
    { method: PaymentMethod.UPI, surchargePercent: 0 },
    { method: PaymentMethod.NET_BANKING, surchargePercent: 1 },
    { method: PaymentMethod.CREDIT_CARD, surchargePercent: 2 },
    { method: PaymentMethod.DEBIT_CARD, surchargePercent: 1 },
  ];
  for (const c of methodConfigs) {
    await prisma.paymentMethodConfig.upsert({
      where: { method: c.method },
      update: { surchargePercent: c.surchargePercent },
      create: { method: c.method, surchargePercent: c.surchargePercent, gstOnSurchargePercent: 18 },
    });
  }

  // 3. Couriers (spec §1: BlueDart/Delhivery high, DTDC/Ekart medium, India Post fallback).
  const couriers: { code: CourierCode; name: string; priority: CourierPriority }[] = [
    { code: CourierCode.BLUEDART, name: "BlueDart", priority: CourierPriority.HIGH },
    { code: CourierCode.DELHIVERY, name: "Delhivery", priority: CourierPriority.HIGH },
    { code: CourierCode.DTDC, name: "DTDC", priority: CourierPriority.MEDIUM },
    { code: CourierCode.EKART, name: "Ekart", priority: CourierPriority.MEDIUM },
    { code: CourierCode.INDIA_POST, name: "India Post", priority: CourierPriority.FALLBACK },
  ];
  for (const c of couriers) {
    await prisma.courier.upsert({
      where: { code: c.code },
      update: { priority: c.priority },
      create: c,
    });
  }

  // 4. Notification event -> channel matrix (a representative subset; B6).
  const matrix: { event: NotificationEvent; channels: NotificationChannel[] }[] = [
    { event: NotificationEvent.ORDER_PLACED, channels: [NotificationChannel.EMAIL, NotificationChannel.SMS, NotificationChannel.WEB] },
    { event: NotificationEvent.ORDER_DISPATCHED, channels: [NotificationChannel.EMAIL, NotificationChannel.SMS] },
    { event: NotificationEvent.ORDER_DELIVERED, channels: [NotificationChannel.EMAIL, NotificationChannel.SMS] },
    { event: NotificationEvent.SMART_EPP_SUBMITTED, channels: [NotificationChannel.EMAIL, NotificationChannel.WEB] },
    { event: NotificationEvent.SMART_EPP_APPROVED, channels: [NotificationChannel.EMAIL, NotificationChannel.SMS, NotificationChannel.WEB] },
    { event: NotificationEvent.SMART_EPP_REJECTED, channels: [NotificationChannel.EMAIL, NotificationChannel.WEB] },
  ];
  for (const m of matrix) {
    for (const channel of m.channels) {
      await prisma.notificationEventChannelMap.upsert({
        where: { event_channel: { event: m.event, channel } },
        update: { enabled: true },
        create: { event: m.event, channel, enabled: true },
      });
    }
  }

  // 5. Default credit policy (revolving, monthly, 1x salary) + a sample company.
  const creditPolicy = await prisma.creditPolicy.upsert({
    where: { id: "seed-default-credit-policy" },
    update: {},
    create: {
      id: "seed-default-credit-policy",
      name: "Default Revolving (1x monthly salary)",
      model: "REVOLVING",
      period: "MONTHLY",
      salaryMultiplier: 1,
    },
  });

  await prisma.company.upsert({
    where: { id: "seed-sample-company" },
    update: {},
    create: {
      id: "seed-sample-company",
      name: "Acme Corp (Sample)",
      status: "ACTIVE",
      creditPolicyId: creditPolicy.id,
    },
  });

  // 6. Session-timeout system config (minutes).
  await prisma.systemConfig.upsert({
    where: { key: "session.timeoutMinutes" },
    update: {},
    create: { key: "session.timeoutMinutes", value: 30 },
  });

  // 7. Sample platform coupons (resellerId null = platform-wide; categoryId null = all products).
  const coupons = [
    { code: "CORP10", type: "PERCENT" as const, value: 10, maxDiscount: 10000, minOrderValue: 0, status: "ACTIVE" as const, usedCount: 312, usageLimit: 2000 },
    { code: "FLAT500", type: "FLAT" as const, value: 500, maxDiscount: null, minOrderValue: 0, status: "ACTIVE" as const, usedCount: 906, usageLimit: 5000 },
    { code: "WELCOME1000", type: "FLAT" as const, value: 1000, maxDiscount: null, minOrderValue: 50000, status: "SCHEDULED" as const, usedCount: 0, usageLimit: 3000 },
  ];
  for (const c of coupons) {
    await prisma.coupon.upsert({
      where: { code: c.code },
      update: {},
      create: c,
    });
  }

  console.log("Seed complete: super admin, payment configs, couriers, notification matrix, sample company, sample coupons.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
