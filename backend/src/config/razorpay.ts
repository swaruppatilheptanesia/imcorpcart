import Razorpay from 'razorpay';
import { env } from './env';
import { AppError } from '../utils/AppError';

let instance: Razorpay | null = null;

export function razorpayConfigured(): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

// Lazy singleton — keys are optional at boot, so checkout endpoints fail with a
// clear error instead of the whole API refusing to start.
export function getRazorpay(): Razorpay {
  if (!razorpayConfigured()) {
    throw AppError.badRequest('Payment gateway is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)');
  }
  if (!instance) {
    instance = new Razorpay({
      key_id: env.RAZORPAY_KEY_ID!,
      key_secret: env.RAZORPAY_KEY_SECRET!,
    });
  }
  return instance;
}
