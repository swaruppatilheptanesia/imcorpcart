import { z } from 'zod';
import { PaymentMethod } from '@prisma/client';

export const shopProductListQuery = z.object({
  category: z.string().trim().optional(),
  q: z.string().trim().optional(),
});

export const addToCartBody = z.object({
  productId: z.string().min(1),
  shade: z.string().trim().optional(),
  qty: z.number().int().positive().max(99).optional(),
});

export const updateCartBody = z.object({
  qty: z.number().int().min(0).max(99),
});

export const validateCouponBody = z.object({
  code: z.string().trim().min(1),
});

export const placeOrderBody = z.object({
  couponCode: z.string().trim().optional(),
  addressId: z.string().optional(), // chosen shipping address; falls back to default
  billingAddressId: z.string().optional(), // null/absent = same as shipping
  // Chosen payment method — decides the surcharge; verified against the captured
  // instrument in placeOrder.
  method: z.nativeEnum(PaymentMethod),
  useWallet: z.boolean().optional(), // redeem wallet balance against the total
  // Razorpay handoff — required for any payable checkout; the service verifies
  // the signature + amount before creating the orders.
  razorpayOrderId: z.string().optional(),
  razorpayPaymentId: z.string().optional(),
  razorpaySignature: z.string().optional(),
});

export const createPaymentOrderBody = z.object({
  couponCode: z.string().trim().optional(),
  method: z.nativeEnum(PaymentMethod),
  useWallet: z.boolean().optional(),
});

export const wishlistBody = z.object({
  productId: z.string().min(1),
});

export const createAddressBody = z.object({
  contactName: z.string().trim().min(1).max(120),
  contactPhone: z.string().trim().min(1).max(20),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(80),
  state: z.string().trim().min(1).max(80),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Enter a valid 6-digit pincode'),
  type: z.enum(['OFFICE', 'HOME', 'COMPANY_DEFINED']).optional(),
  label: z.string().trim().max(60).optional(),
  isBilling: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export const updateAddressBody = createAddressBody.partial();

export type ShopProductListQuery = z.infer<typeof shopProductListQuery>;
export type AddToCartInput = z.infer<typeof addToCartBody>;
export type UpdateCartInput = z.infer<typeof updateCartBody>;
export type ValidateCouponInput = z.infer<typeof validateCouponBody>;
export type PlaceOrderInput = z.infer<typeof placeOrderBody>;
export type CreatePaymentOrderInput = z.infer<typeof createPaymentOrderBody>;
export type WishlistInput = z.infer<typeof wishlistBody>;
