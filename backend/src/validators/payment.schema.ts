import { z } from 'zod';
import { PaymentMethod, GatewayProvider } from '@prisma/client';

export const updatePaymentConfigBody = z.object({
  methods: z
    .array(
      z.object({
        method: z.nativeEnum(PaymentMethod),
        surchargePercent: z.number().min(0).max(100),
        gstOnSurchargePercent: z.number().min(0).max(100).optional(),
        active: z.boolean().optional(),
      }),
    )
    .optional(),
  gateways: z
    .array(
      z.object({
        provider: z.nativeEnum(GatewayProvider),
        merchantId: z.string().optional(),
        // Secret material — write-only, never returned.
        keyRef: z.string().optional(),
        webhookRef: z.string().optional(),
        active: z.boolean().optional(),
      }),
    )
    .optional(),
});

export type UpdatePaymentConfigInput = z.infer<typeof updatePaymentConfigBody>;
