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
  // Restrict which instruments the modal offers (locks it to the chosen method).
  config?: unknown;
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

// Our PaymentMethod → the Razorpay instrument the modal is locked to. CREDIT_CARD
// is the canonical row behind the merged "Card" option the picker shows, so it must
// stay an unfiltered `card` — narrowing it to credit would reject debit cards the
// shopper was offered. DEBIT_CARD is only reachable if an admin un-merges the two,
// and then `types` is what keeps each on its own surcharge.
export const RZP_INSTRUMENT: Record<string, { label: string; method: string; types?: string[] }> = {
  UPI: { label: 'Pay by UPI', method: 'upi' },
  NET_BANKING: { label: 'Pay by net banking', method: 'netbanking' },
  CREDIT_CARD: { label: 'Pay by card', method: 'card' },
  DEBIT_CARD: { label: 'Pay by debit card', method: 'card', types: ['debit'] },
};

// Show only the chosen instrument in the modal. `show_default_blocks: false` is what
// suppresses everything else — without it our block is merely added to the full list.
// Returns undefined for an unknown method so the modal falls back to showing all,
// rather than opening with nothing payable.
export function lockToMethod(method: string | null | undefined) {
  const m = method ? RZP_INSTRUMENT[method] : undefined;
  if (!m) return undefined;
  return {
    display: {
      blocks: {
        chosen: {
          name: m.label,
          instruments: [m.types ? { method: m.method, types: m.types } : { method: m.method }],
        },
      },
      sequence: ['block.chosen'],
      preferences: { show_default_blocks: false },
    },
  };
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
