import type { SemanticTone } from '@/data/types';

/**
 * What an employee sees for an order: the detailed shipment status while it is
 * on the road, so "Out for delivery" shows on the list and the detail page —
 * not only on the Track page. The order status alone folds every courier stage
 * into DISPATCHED.
 *
 * A courier-reported delivery issue (ShipmentStatus FAILED — attempted, held,
 * refused…) is shown simply as "Failed"; the admin sees it as "Delivery issue".
 * Storefront-only on purpose: the reseller portal shares `StoreOrderStatus`.
 */
export type ShopOrderLabel =
  | 'Processing'
  | 'Dispatched'
  | 'In transit'
  | 'Out for delivery'
  | 'Failed'
  | 'Delivered'
  | 'Returned'
  | 'Cancelled';

const ON_THE_ROAD: Record<string, ShopOrderLabel> = {
  DISPATCHED: 'Dispatched',
  IN_TRANSIT: 'In transit',
  OUT_FOR_DELIVERY: 'Out for delivery',
  FAILED: 'Failed',
};

export function shopStatusLabel(orderStatus: string, shipmentStatus?: string | null): ShopOrderLabel {
  switch (orderStatus) {
    case 'PLACED':
    case 'CONFIRMED':
      return 'Processing';
    case 'DISPATCHED':
      return (shipmentStatus && ON_THE_ROAD[shipmentStatus]) || 'In transit';
    case 'DELIVERED':
      return 'Delivered';
    case 'RETURNED':
      return 'Returned';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return 'Processing';
  }
}

export const SHOP_STATUS_TONE: Record<ShopOrderLabel, SemanticTone> = {
  Processing: 'warning',
  Dispatched: 'info',
  'In transit': 'info',
  'Out for delivery': 'info',
  Failed: 'error',
  Delivered: 'success',
  Returned: 'neutral',
  Cancelled: 'error',
};

/** Orders-list tabs. A returned order sits with the cancelled ones. */
export function shopStatusBucket(label: ShopOrderLabel): 'active' | 'delivered' | 'cancelled' {
  if (label === 'Delivered') return 'delivered';
  if (label === 'Cancelled' || label === 'Returned') return 'cancelled';
  return 'active';
}

/** Tracking-event codes → the same words, for the Track page's event list. */
export const SHIPMENT_EVENT_LABEL: Record<string, string> = {
  PENDING: 'Processing',
  DISPATCHED: 'Dispatched',
  IN_TRANSIT: 'In transit',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  FAILED: 'Failed',
  RETURNED: 'Returned',
};
