import { useState } from 'react';
import { UploadCloud, Info, FileSpreadsheet } from 'lucide-react';
import { Segmented, Card, Field, Input, Button, useToast } from '@/components';
import s from './screen.module.css';
import styles from './Bulk.module.css';

export function Bulk() {
  const { flash } = useToast();
  const [tab, setTab] = useState<'import' | 'price'>('import');
  const [scope, setScope] = useState('all');
  const [value, setValue] = useState('');

  return (
    <div className={s.narrow}>
      <div className={styles.tabs}>
        <Segmented
          options={[
            { value: 'import', label: 'Product import' },
            { value: 'price', label: 'Price update' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'import' ? (
        <Card pad="lg">
          <div className={styles.template}>
            <span className={styles.templateIcon}>
              <FileSpreadsheet size={20} />
            </span>
            <div className={styles.templateBody}>
              <div className={styles.templateTitle}>Import your catalog</div>
              <div className={styles.templateSub}>
                Upload a CSV of your products. Only your own SKUs (TR-…) can be imported.
              </div>
            </div>
          </div>
          <button className={styles.dropzone} onClick={() => flash('Select a CSV to import')}>
            <UploadCloud size={28} />
            <div className={styles.dropTitle}>Upload a filled CSV</div>
            <div className={styles.dropSub}>.csv · header row required · max 5MB</div>
          </button>
        </Card>
      ) : (
        <Card pad="lg">
          <div className={s.grid2}>
            <Field label="Apply to">
              <select className={styles.select} value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="all">All my products</option>
                <option value="phones">Phones</option>
                <option value="accessories">Accessories</option>
              </select>
            </Field>
            <Field label="Adjustment">
              <select className={styles.select} defaultValue="increase">
                <option value="increase">Increase by %</option>
                <option value="decrease">Decrease by %</option>
                <option value="set">Set to ₹</option>
              </select>
            </Field>
          </div>
          <Field label="Value">
            <Input prefix="%" inputMode="numeric" placeholder="5" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <div className={styles.info}>
            <Info size={16} />
            Changes apply to your EPP prices only.
          </div>
          <div className={styles.footer}>
            <Button variant="secondary" onClick={() => setValue('')}>
              Reset
            </Button>
            <Button onClick={() => flash('Price update applied')}>Apply</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
