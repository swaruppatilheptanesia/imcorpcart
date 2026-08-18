import { ShieldCheck, Truck, BadgePercent, Headset } from 'lucide-react';
import { Card } from '@/components';
import styles from './About.module.css';

const PERKS = [
  { icon: BadgePercent, title: 'Corporate EPP pricing', body: 'Negotiated employee rates applied automatically at checkout — no codes to hunt for.' },
  { icon: ShieldCheck, title: 'Genuine, warrantied products', body: 'Every phone, accessory, and bag ships brand-new with full manufacturer warranty.' },
  { icon: Truck, title: 'Fast, tracked delivery', body: 'Doorstep delivery to your saved address with live tracking on every order.' },
  { icon: Headset, title: 'Dedicated support', body: 'A support team for anything from order changes to delivery questions.' },
];

export function About() {
  return (
    <div className={styles.wrap}>
      <Card pad="lg" className={styles.head}>
        <div className={styles.overline}>Employee Purchase Program</div>
        <h1 className={styles.title}>Corporate pricing on everything you carry.</h1>
        <p className={styles.lede}>
          imcorpcart is the purchase program built for your company. Browse a curated catalog of phones,
          accessories, and bags at rates negotiated for employees — everything in one storefront, delivered
          to your door.
        </p>
      </Card>

      <div className={styles.grid}>
        {PERKS.map((p) => {
          const Icon = p.icon;
          return (
            <Card key={p.title} pad="lg" className={styles.perk}>
              <span className={styles.perkIcon}>
                <Icon size={20} />
              </span>
              <div className={styles.perkTitle}>{p.title}</div>
              <div className={styles.perkBody}>{p.body}</div>
            </Card>
          );
        })}
      </div>

      <Card pad="lg">
        <div className={styles.sectionTitle}>How it works</div>
        <ol className={styles.steps}>
          <li>Sign in with your work email — your company's EPP rates unlock automatically.</li>
          <li>Add products to your cart and apply any eligible coupons.</li>
          <li>Choose a delivery address and place your order — that's it.</li>
        </ol>
      </Card>
    </div>
  );
}
