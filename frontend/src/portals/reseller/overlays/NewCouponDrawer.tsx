import { useState } from 'react';
import { Drawer, Field, Input, Segmented, Chip, Button, useToast } from '@/components';
import { resellerCouponScopes } from '@/data/fixtures/reseller';
import type { CouponType } from '@/data/store-types';
import styles from './NewCouponDrawer.module.css';

export function NewCouponDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { flash } = useToast();
  const [code, setCode] = useState('');
  const [type, setType] = useState<CouponType>('pct');
  const [value, setValue] = useState('');
  const [cap, setCap] = useState('');
  const [min, setMin] = useState('');
  const [scope, setScope] = useState(resellerCouponScopes[0]);

  const reset = () => {
    setCode('');
    setType('pct');
    setValue('');
    setCap('');
    setMin('');
    setScope(resellerCouponScopes[0]);
  };

  const save = () => {
    if (!code.trim()) {
      flash('Enter a coupon code');
      return;
    }
    flash(`${code.trim().toUpperCase()} created`);
    onClose();
    reset();
  };
  const close = () => {
    onClose();
    reset();
  };

  return (
    <Drawer
      open={open}
      onClose={close}
      title="New coupon"
      footer={
        <>
          <Button variant="secondary" block onClick={close}>
            Cancel
          </Button>
          <Button block onClick={save}>
            Create coupon
          </Button>
        </>
      }
    >
      <Field label="Coupon code">
        <Input
          placeholder="TECHNO10"
          value={code}
          accent={!!code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
      </Field>

      <Field label="Discount type">
        <Segmented
          options={[
            { value: 'pct', label: '% off' },
            { value: 'flat', label: '₹ off' },
          ]}
          value={type}
          onChange={setType}
          tone="fill"
        />
      </Field>

      <div className={styles.pair}>
        <Field label={type === 'pct' ? 'Discount %' : 'Discount amount'}>
          <Input
            prefix={type === 'pct' ? '%' : '₹'}
            inputMode="numeric"
            placeholder={type === 'pct' ? '10' : '500'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        {type === 'pct' && (
          <Field label="Max discount cap">
            <Input prefix="₹" inputMode="numeric" placeholder="8,000" value={cap} onChange={(e) => setCap(e.target.value)} />
          </Field>
        )}
      </div>

      <Field label="Minimum order value" hint="Leave blank for no minimum">
        <Input prefix="₹" inputMode="numeric" placeholder="0" value={min} onChange={(e) => setMin(e.target.value)} />
      </Field>

      <Field label="Applies to">
        <div className={styles.chips}>
          {resellerCouponScopes.map((sc) => (
            <Chip key={sc} label={sc} active={scope === sc} variant="tint" onClick={() => setScope(sc)} />
          ))}
        </div>
      </Field>
    </Drawer>
  );
}
