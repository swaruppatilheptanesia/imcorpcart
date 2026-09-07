import { useNavigate, useParams } from 'react-router-dom';
import { FileText, Download, Truck, AlertTriangle, Gift, Clock, Copy } from 'lucide-react';
import { Card, Button, StatusPill, Skeleton, EmptyState, useToast } from '@/components';
import type { SemanticTone } from '@/data/types';
import type { StoreOrderStatus } from '@/data/store-types';
import { inr } from '@/lib/format';
import { fmtDate, gradientFor } from '@/data/map';
import { useAsync } from '@/lib/useAsync';
import { getOrder } from '@/data/shop-api';
import styles from './OrderDetail.module.css';

const tone: Record<StoreOrderStatus, SemanticTone> = {
  Processing: 'warning',
  'In transit': 'info',
  Delivered: 'success',
  Cancelled: 'error',
};
const STATUS_IN: Record<string, StoreOrderStatus> = {
  PLACED: 'Processing',
  CONFIRMED: 'Processing',
  DISPATCHED: 'In transit',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  RETURNED: 'Cancelled',
};
const PAY_METHOD_LABEL: Record<string, string> = {
  UPI: 'UPI',
  NET_BANKING: 'Net Banking',
  CREDIT_CARD: 'Credit / Debit Card',
  DEBIT_CARD: 'Debit Card',
};
const PAY_STATUS_LABEL: Record<string, string> = {
  CAPTURED: 'Paid',
  AUTHORIZED: 'Authorized',
  PENDING: 'Pending',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
};

export function OrderDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: order, state, error, reload } = useAsync<any>(() => getOrder(id ?? ''), [id]);

  if (state === 'loading') return <Skeleton h={360} />;
  if (state === 'error' || !order)
    return (
      <EmptyState
        tone="error"
        icon={<AlertTriangle size={24} />}
        title="Order not found"
        body={error ?? 'This order may no longer be available.'}
        action={{ label: 'Retry', onClick: reload }}
      />
    );

  const status: StoreOrderStatus = STATUS_IN[order.status] ?? 'Processing';
  // Reseller name intentionally omitted — employees don't see the vendor.
  const vendorNote = ['imcorpcart', order.shipment?.courier?.name].filter(Boolean).join(' · ');
  const addr = order.address;

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div>
          <div className={styles.orderId}>{order.orderNo}</div>
          <div className={styles.sub}>{fmtDate(order.createdAt)} · {vendorNote}</div>
        </div>
        <StatusPill label={status} tone={tone[status]} size="md" />
      </div>

      <div className={styles.grid}>
        <div className={styles.col}>
          <Card>
            <div className={styles.cardTitle}>Items</div>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {order.items.map((l: any, i: number) => {
              const [g1, g2] = gradientFor(l.product.id);
              const vf = l.voucherFulfilment; // present only on gift-card lines
              return (
                <div key={i}>
                  <div className={styles.item}>
                    <span className={styles.device} style={{ background: `linear-gradient(155deg, ${g1}, ${g2})` }} />
                    <div className={styles.itemBody}>
                      <div className={styles.itemName}>{l.product.name}</div>
                      <div className={styles.itemSub}>
                        Qty {l.quantity}
                        {vf?.denomination ? ` · ${inr(vf.denomination)} each` : ''}
                      </div>
                    </div>
                    <span className={styles.itemPrice}>{inr(l.lineTotal)}</span>
                  </div>
                  {vf && <VoucherPanel vf={vf} />}
                </div>
              );
            })}
          </Card>

          {status !== 'Cancelled' && (
            <Button variant="secondary" icon={<Truck size={16} />} onClick={() => navigate(`/shop/tracking/${order.orderNo}`)}>
              Track this order
            </Button>
          )}

          <Card>
            <div className={styles.cardTitle}>Documents</div>
            <div className={styles.docs}>
              {['Tax invoice', 'Proof of delivery'].map((d) => (
                <button key={d} className={styles.doc}>
                  <span className={styles.docLeft}>
                    <FileText size={16} /> {d}
                  </span>
                  <Download size={15} />
                </button>
              ))}
            </div>
          </Card>
        </div>

        <div className={styles.col}>
          <Card>
            <div className={styles.cardTitle}>Summary</div>
            <div className={styles.row}><span>Subtotal</span><span>{inr(order.subtotal)}</span></div>
            {order.exhibitionDiscount > 0 && (
              <div className={styles.row}><span>Exhibition discount</span><span>−{inr(order.exhibitionDiscount)}</span></div>
            )}
            {order.couponDiscount > 0 && (
              <div className={styles.row}><span>Coupon discount</span><span>−{inr(order.couponDiscount)}</span></div>
            )}
            {order.surcharge > 0 && <div className={styles.row}><span>Surcharge</span><span>{inr(order.surcharge)}</span></div>}
            {order.gst > 0 && <div className={styles.row}><span>GST</span><span>{inr(order.gst)}</span></div>}
            <div className={styles.divider} />
            <div className={styles.totalRow}><span>Total</span><span>{inr(order.total)}</span></div>
          </Card>

          {order.payments?.length > 0 && (() => {
            // One captured payment per order (a split checkout shares one gateway txn).
            const pay = order.payments[0];
            return (
              <Card>
                <div className={styles.cardTitle}>Payment</div>
                <div className={styles.row}><span>Method</span><span>{PAY_METHOD_LABEL[pay.method] ?? pay.method}</span></div>
                <div className={styles.row}><span>Paid via</span><span>{pay.gateway === 'RAZORPAY' ? 'Razorpay' : pay.gateway}</span></div>
                <div className={styles.row}><span>Amount paid</span><span>{inr(pay.total)}</span></div>
                <div className={styles.row}><span>Status</span><span>{PAY_STATUS_LABEL[pay.status] ?? pay.status}</span></div>
                {pay.gatewayTxnId && (
                  <div className={styles.row}><span>Transaction ID</span><span className={styles.txn}>{pay.gatewayTxnId}</span></div>
                )}
              </Card>
            );
          })()}
          {addr && (
            <Card>
              <div className={styles.cardTitle}>Ship to</div>
              <div className={styles.ship}>
                <div className={styles.shipName}>{addr.contactName}</div>
                <div className={styles.shipLine}>
                  {[addr.line1, addr.line2, addr.city, addr.pincode].filter(Boolean).join(', ')}
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// Gift-card (Hubble voucher) fulfilment panel for one order item: shows the issued
// code (copy) once delivered, an "issuing" state while Hubble processes, or a
// refunded notice if it couldn't be issued. `vf` is the item's voucherFulfilment.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function VoucherPanel({ vf }: { vf: any }) {
  const { flash } = useToast();
  const status: string = vf.status;
  const copy = (label: string, value: string) => {
    navigator.clipboard?.writeText(value).then(
      () => flash(`${label} copied`),
      () => {},
    );
  };

  if (status === 'DELIVERED') {
    const expiry = vf.voucherExpiry ? new Date(vf.voucherExpiry).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
    return (
      <div className={styles.voucherPanel}>
        <div className={styles.voucherHead}>
          <Gift size={15} /> Your gift card
        </div>
        {vf.voucherCode && (
          <button className={styles.voucherCred} onClick={() => copy('Card number', vf.voucherCode)}>
            <div>
              <div className={styles.credLabel}>Card number</div>
              <div className={styles.credValue}>{vf.voucherCode}</div>
            </div>
            <Copy size={15} />
          </button>
        )}
        {vf.voucherPin && (
          <button className={styles.voucherCred} onClick={() => copy('PIN', vf.voucherPin)}>
            <div>
              <div className={styles.credLabel}>PIN</div>
              <div className={styles.credValue}>{vf.voucherPin}</div>
            </div>
            <Copy size={15} />
          </button>
        )}
        <div className={styles.voucherMeta}>
          {expiry ? `Valid till ${expiry}. ` : ''}Also emailed to you. Treat this code like cash.
        </div>
        {vf.redemptionUrl && (
          <a className={styles.voucherLink} href={vf.redemptionUrl} target="_blank" rel="noreferrer">
            Redeem your gift card →
          </a>
        )}
      </div>
    );
  }

  if (status === 'FAILED') {
    return (
      <div className={`${styles.voucherPanel} ${styles.voucherFailed}`}>
        <div className={styles.voucherHead}>
          <AlertTriangle size={15} /> Couldn’t issue this gift card
        </div>
        <div className={styles.voucherMeta}>
          We weren’t able to issue this gift card and you’ve been refunded. Please contact support if you need help.
        </div>
      </div>
    );
  }

  // PENDING / PROCESSING
  return (
    <div className={`${styles.voucherPanel} ${styles.voucherPending}`}>
      <div className={styles.voucherHead}>
        <Clock size={15} /> Your gift card is being issued
      </div>
      <div className={styles.voucherMeta}>
        This usually takes a moment. We’ll email your code and show it here as soon as it’s ready — refresh in a bit.
      </div>
    </div>
  );
}
