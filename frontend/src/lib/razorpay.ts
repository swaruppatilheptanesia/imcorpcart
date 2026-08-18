// Razorpay Checkout (checkout.js) — idempotent script loader + typed wrapper.

export interface RazorpayPaymentResult {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface RazorpayOptions {
  key: string;
  amount: number; // paise
  currency: string;
  order_id: string;
  name: string;
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string; method?: string };
  theme?: { color?: string };
  handler: (result: RazorpayPaymentResult) => void;
  modal?: { ondismiss?: () => void };
}

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', cb: (resp: { error?: { description?: string } }) => void): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

let loader: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (!loader) {
    loader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        loader = null;
        s.remove();
        reject(new Error('Could not load the payment gateway — check your connection'));
      };
      document.body.appendChild(s);
    });
  }
  return loader;
}

export async function openRazorpay(
  options: RazorpayOptions & { onFailed?: (message: string) => void },
): Promise<void> {
  await loadScript();
  const { onFailed, ...opts } = options;
  const rzp = new window.Razorpay!(opts);
  if (onFailed) {
    rzp.on('payment.failed', (resp) => onFailed(resp.error?.description ?? 'Payment failed'));
  }
  rzp.open();
}
