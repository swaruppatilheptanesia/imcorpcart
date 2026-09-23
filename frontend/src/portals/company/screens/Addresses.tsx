import { useState } from 'react';
import { AlertTriangle, MapPin, Plus, Pencil, Trash2 } from 'lucide-react';
import { Button, DataTable, Row, StatusPill, EmptyState, Skeleton, useToast } from '@/components';
import { getBranches, deleteBranch, type CompanyBranch } from '@/data/company-api';
import { useAsync } from '@/lib/useAsync';
import { BranchAddressModal } from '../overlays/BranchAddressModal';
import s from '../../super-admin/screens/screen.module.css';

const COLS = 'minmax(0, 1.2fr) minmax(0, 2fr) minmax(0, 1.3fr) 90px 110px';

/** The company's office branches — the only addresses a Smart EPP lease order
 *  can be delivered to (employees pick one at request time). */
export function Addresses() {
  const { flash } = useToast();
  const [modal, setModal] = useState<{ open: boolean; branch: CompanyBranch | null }>({ open: false, branch: null });
  const { data, state, error, reload } = useAsync(() => getBranches(), [], (d) => d.length === 0);

  const remove = async (b: CompanyBranch) => {
    if (!window.confirm(`Delete "${b.label ?? b.city}"?`)) return;
    try {
      await deleteBranch(b.id);
      flash('Branch deleted');
      reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not delete');
    }
  };

  return (
    <div>
      <div className={s.toolbar}>
        <span className={s.muted} style={{ fontSize: 13 }}>
          Smart EPP devices ship only to these branches; HR receives and hands them over.
        </span>
        <div className={s.spacer} />
        <Button size="sm" icon={<Plus size={16} strokeWidth={2.2} />} onClick={() => setModal({ open: true, branch: null })}>
          Add branch
        </Button>
      </div>

      {state === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} h={52} />
          ))}
        </div>
      )}

      {state === 'error' && (
        <EmptyState
          tone="error"
          icon={<AlertTriangle size={24} />}
          title="Couldn't load addresses"
          body={error ?? 'Something went wrong.'}
          action={{ label: 'Retry', onClick: reload }}
        />
      )}

      {state === 'empty' && (
        <EmptyState
          icon={<MapPin size={24} />}
          title="No office addresses yet"
          body="Add your branches so employees can choose where their Smart EPP device is delivered."
          action={{ label: 'Add branch', onClick: () => setModal({ open: true, branch: null }) }}
        />
      )}

      {state === 'live' && data && (
        <DataTable cols={COLS} headers={['Branch', 'Address', 'Contact', 'Default', '']}>
          {data.map((b) => (
            <Row key={b.id} cols={COLS}>
              <div className={s.cellName}>{b.label ?? '—'}</div>
              <div className={s.muted}>{[b.line1, b.line2, `${b.city}, ${b.state}`, b.pincode].filter(Boolean).join(', ')}</div>
              <div className={s.muted}>
                {b.contactName}
                <div className={s.cellSub}>{b.contactPhone}</div>
              </div>
              <div>{b.isDefault && <StatusPill label="Default" tone="info" />}</div>
              <div className={s.rowActions} style={{ justifyContent: 'flex-end' }}>
                <button className={s.iconBtn} onClick={() => setModal({ open: true, branch: b })} aria-label="Edit">
                  <Pencil size={16} />
                </button>
                <button className={s.iconBtn} onClick={() => remove(b)} aria-label="Delete">
                  <Trash2 size={16} />
                </button>
              </div>
            </Row>
          ))}
        </DataTable>
      )}

      {modal.open && (
        <BranchAddressModal
          branch={modal.branch}
          onClose={() => setModal({ open: false, branch: null })}
          onSaved={() => {
            setModal({ open: false, branch: null });
            reload();
          }}
        />
      )}
    </div>
  );
}
