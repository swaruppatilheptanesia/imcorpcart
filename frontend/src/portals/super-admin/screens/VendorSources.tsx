import { useNavigate } from 'react-router-dom';
import { Download, AlertTriangle } from 'lucide-react';
import { DataTable, Row, StatusPill, EmptyState, Skeleton } from '@/components';
import { getVendorSources } from '@/data/api';
import { useAsync } from '@/lib/useAsync';
import { fmtDate } from '@/data/map';
import { statusTone } from './Partners';
import s from './screen.module.css';
import styles from './Partners.module.css';

const COLS = '1.5fr 1.1fr 1.2fr 0.7fr 0.9fr 24px';

// Vendors are dev-integrated adapters, not admin-created — each registered
// adapter is auto-provisioned as a source and appears here automatically. The
// admin only validates (Run sync), suspends/hides, sets our price and handles
// orders. There is no "Add source" / delete here.
export function VendorSources() {
  const navigate = useNavigate();
  const { data, state, error, reload } = useAsync(() => getVendorSources(), [], (d) => d.length === 0);

  return (
    <div>
      <p className={s.muted} style={{ fontSize: 12.5, margin: '2px 2px 14px' }}>
        Integrated vendors appear here automatically. Open one to sync its catalog, set our price, hide products
        or suspend the vendor. Imported products are first-party and go live at our price.
      </p>

      {state === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} h={52} />
          ))}
        </div>
      )}

      {state === 'error' && (
        <EmptyState
          tone="error"
          icon={<AlertTriangle size={24} />}
          title="Couldn't load vendor sources"
          body={error ?? 'Something went wrong.'}
          action={{ label: 'Retry', onClick: reload }}
        />
      )}

      {state === 'empty' && (
        <EmptyState
          icon={<Download size={24} />}
          title="No vendors integrated yet"
          body="Integrated vendors appear here automatically. Ask the team to add an adapter to onboard a new vendor."
        />
      )}

      {state === 'live' && data && (
        <DataTable cols={COLS} headers={['Source', 'Adapter', 'Discount', 'Products', 'Last synced', '']}>
          {data.map((v) => (
            <Row key={v.id} cols={COLS} onClick={() => navigate(`/super-admin/vendorSourceDetail/${v.id}`)}>
              <div className={styles.nameCell}>
                <div className={styles.name}>{v.name}</div>
                <StatusPill label={v.active ? v.status : 'Suspended'} tone={v.active ? statusTone[v.status] : 'neutral'} />
              </div>
              <div className={s.muted}>{v.adapter}</div>
              <div className={s.muted}>EPP = MRP − {v.discountPct}%</div>
              <div className={s.muted}>{v._count?.products ?? 0}</div>
              <div className={s.muted}>{v.lastSyncedAt ? fmtDate(v.lastSyncedAt) : 'Never'}</div>
              <div />
            </Row>
          ))}
        </DataTable>
      )}
    </div>
  );
}
