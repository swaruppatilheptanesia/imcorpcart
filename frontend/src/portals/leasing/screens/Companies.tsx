import { AlertTriangle, Building2 } from 'lucide-react';
import { DataTable, Row, StatusPill, EmptyState, Skeleton } from '@/components';
import { getCompanies } from '@/data/leasing-api';
import type { SemanticTone } from '@/data/types';
import { useAsync } from '@/lib/useAsync';
import s from '../../super-admin/screens/screen.module.css';

const COLS = 'minmax(0, 2fr) 110px 120px 130px 130px 140px';

const orgTone: Record<string, SemanticTone> = {
  ACTIVE: 'success',
  SUSPENDED: 'error',
  ONBOARDING: 'warning',
};

/** Corporates the Super Admin has attached to this leasing company. Read-only —
 *  ADLD % and tax slab are set by the platform per company. */
export function Companies() {
  const { data, state, error, reload } = useAsync(() => getCompanies(), [], (d) => d.length === 0);
  const rows = data ?? [];

  return (
    <div>
      {state === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} h={56} />
          ))}
        </div>
      )}
      {state === 'error' && (
        <EmptyState
          tone="error"
          icon={<AlertTriangle size={24} />}
          title="Couldn't load companies"
          body={error ?? 'Something went wrong.'}
          action={{ label: 'Retry', onClick: reload }}
        />
      )}
      {state === 'empty' && (
        <EmptyState
          icon={<Building2 size={24} />}
          title="No companies attached"
          body="The imcorpcart admin attaches corporates to your leasing company; their employees then lease through you."
        />
      )}
      {state === 'live' && (
        <DataTable cols={COLS} headers={['Company', 'Employees', 'Smart EPP', 'ADLD / tax slab', 'Requests', 'Status']}>
          {rows.map((c) => (
            <Row key={c.id} cols={COLS}>
              <div>
                <div className={s.cellName}>{c.name}</div>
                <div className={s.cellSub}>{c.domain ?? '—'}</div>
              </div>
              <div className={s.muted}>{c.employees}</div>
              <div>
                <StatusPill label={c.smartEppEnabled ? 'Enabled' : 'Off'} tone={c.smartEppEnabled ? 'success' : 'neutral'} />
              </div>
              <div className={s.muted}>
                {c.adldPct != null ? `${c.adldPct}% ADLD` : 'No ADLD'} · {c.incomeTaxPct}%
              </div>
              <div className={s.muted}>
                {c.requests.pending > 0 && <strong style={{ color: 'var(--text)' }}>{c.requests.pending} pending</strong>}
                {c.requests.pending > 0 && (c.requests.active > 0 || c.requests.rejected > 0) ? ' · ' : ''}
                {c.requests.active > 0 && `${c.requests.active} active`}
                {c.requests.pending === 0 && c.requests.active === 0 && c.requests.rejected === 0 && '—'}
              </div>
              <div>
                <StatusPill label={c.status} tone={orgTone[c.status] ?? 'neutral'} />
              </div>
            </Row>
          ))}
        </DataTable>
      )}
    </div>
  );
}
