import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { serialize } from '../models/serializers';
import type { UpdatePaymentConfigInput } from '../validators/payment.schema';

const D = (n: number) => new Prisma.Decimal(n);

// Secret refs are never returned — only a boolean indicating whether one is set.
export async function getPaymentConfig() {
  const [methods, gateways] = await prisma.$transaction([
    prisma.paymentMethodConfig.findMany({ orderBy: { method: 'asc' } }),
    prisma.paymentGatewayConfig.findMany({ orderBy: { provider: 'asc' } }),
  ]);

  return {
    methods: serialize(methods),
    gateways: gateways.map((g) => ({
      id: g.id,
      provider: g.provider,
      merchantId: g.merchantId,
      active: g.active,
      hasKey: Boolean(g.keyRef),
      hasWebhook: Boolean(g.webhookRef),
    })),
  };
}

export async function updatePaymentConfig(input: UpdatePaymentConfigInput) {
  await prisma.$transaction(async (tx) => {
    for (const m of input.methods ?? []) {
      await tx.paymentMethodConfig.upsert({
        where: { method: m.method },
        create: {
          method: m.method,
          surchargePercent: D(m.surchargePercent),
          gstOnSurchargePercent: D(m.gstOnSurchargePercent ?? 18),
          active: m.active ?? true,
        },
        update: {
          surchargePercent: D(m.surchargePercent),
          ...(m.gstOnSurchargePercent !== undefined ? { gstOnSurchargePercent: D(m.gstOnSurchargePercent) } : {}),
          ...(m.active !== undefined ? { active: m.active } : {}),
        },
      });
    }

    for (const g of input.gateways ?? []) {
      await tx.paymentGatewayConfig.upsert({
        where: { provider: g.provider },
        create: {
          provider: g.provider,
          merchantId: g.merchantId,
          keyRef: g.keyRef,
          webhookRef: g.webhookRef,
          active: g.active ?? false,
        },
        update: {
          ...(g.merchantId !== undefined ? { merchantId: g.merchantId } : {}),
          ...(g.keyRef !== undefined ? { keyRef: g.keyRef } : {}),
          ...(g.webhookRef !== undefined ? { webhookRef: g.webhookRef } : {}),
          ...(g.active !== undefined ? { active: g.active } : {}),
        },
      });
    }
  });

  return getPaymentConfig();
}
