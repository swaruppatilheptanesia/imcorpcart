import { Landmark } from 'lucide-react';
import { Segmented } from '@/components';
import { inr } from '@/lib/format';
import { useStore, type PurchaseMode } from '../store-context';
import styles from './PurchaseModeToggle.module.css';

const OPTIONS: { value: PurchaseMode; label: string }[] = [
  { value: 'EPP', label: 'EPP · Pay now' },
  { value: 'SEPP', label: 'Smart EPP · Pay monthly' },
];

/** EPP ↔ Smart EPP switch shown under the promo banner for employees whose
 *  company offers lease financing. Purely a view mode: prices on cards, the
 *  product page and the cart/checkout flow follow it. */
export function PurchaseModeToggle() {
  const { authed, sepp, purchaseMode, setPurchaseMode } = useStore();
  if (!authed || !sepp?.enabled) return null;

  const isSepp = purchaseMode === 'SEPP';
  return (
    <div className={styles.wrap}>
      <div className={styles.left}>
        <span className={styles.icon}>
          <Landmark size={16} />
        </span>
        <div>
          <div className={styles.title}>{isSepp ? 'Smart EPP — pay monthly from salary' : 'Choose how you want to buy'}</div>
          <div className={styles.hint}>
            {isSepp
              ? `Lease via ${sepp.leasingCompany} over ${sepp.tenureMonths} months · needs HR & leasing approval · ${inr(sepp.available)} of your limit available`
              : 'Pay upfront at your corporate EPP price, or switch to Smart EPP to lease a phone on monthly salary deduction.'}
          </div>
        </div>
      </div>
      <Segmented options={OPTIONS} value={purchaseMode} onChange={setPurchaseMode} tone="accent" />
    </div>
  );
}
