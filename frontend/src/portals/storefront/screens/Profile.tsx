import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, LogOut, ChevronRight, AlertTriangle, Plus, Pencil, Trash2 } from 'lucide-react';
import { Card, Avatar, Button, Skeleton, EmptyState, StatusPill, useToast } from '@/components';
import { inr } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { getProfile, deleteAddress, getWallet } from '@/data/shop-api';
import type { ShopAddress } from '@/data/store-types';
import { ApiError } from '@/data/http';
import { AddressModal } from '../overlays/AddressModal';
import styles from './Profile.module.css';

const initialsOf = (name: string) =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

const addrLine = (a: ShopAddress) =>
  [a.line1, a.line2, `${a.city}, ${a.state}`, a.pincode].filter(Boolean).join(', ');

export function Profile({ onSignOut }: { onSignOut: () => void }) {
  const navigate = useNavigate();
  const { data: p, state, error, reload } = useAsync(() => getProfile(), []);
  const { data: wallet } = useAsync(() => getWallet(), []);
  const [editing, setEditing] = useState<{ address: ShopAddress | null; billing: boolean } | null>(null);

  if (state === 'loading') return <Skeleton h={420} />;
  if (state === 'error' || !p)
    return (
      <EmptyState
        tone="error"
        icon={<AlertTriangle size={24} />}
        title="Couldn't load profile"
        body={error ?? 'Something went wrong.'}
        action={{ label: 'Retry', onClick: reload }}
      />
    );

  const limit = p.creditLimit ?? 0;
  const available = Math.max(0, limit - p.creditUsed);
  const usedPct = limit > 0 ? Math.min(100, Math.round((p.creditUsed / limit) * 100)) : 0;
  const onboarding = p.companyStatus === 'ONBOARDING';

  const shipping = p.addresses.filter((a) => !a.isBilling);
  const billing = p.addresses.find((a) => a.isBilling) ?? null;

  return (
    <div className={styles.wrap}>
      <Card pad="lg" className={styles.header}>
        <Avatar initials={initialsOf(p.name)} size={54} />
        <div>
          <div className={styles.name}>{p.name}</div>
          <div className={styles.sub}>{p.email}</div>
          <div className={styles.company}>
            {p.company} · <span className={styles.program}>{p.program}</span>
          </div>
        </div>
      </Card>

      {/* imcorpcart Wallet — spendable cashback */}
      <Card pad="lg" className={styles.wallet}>
        <div className={styles.walletHead}>
          <div>
            <div className={styles.cardTitle} style={{ marginBottom: 4 }}>imcorpcart Wallet</div>
            <div className={styles.walletBalance}>{inr(p.walletBalance)}</div>
            <div className={styles.creditNote}>Cashback from delivered orders — spend it at checkout.</div>
          </div>
        </div>
        {wallet && wallet.entries.length > 0 ? (
          <div className={styles.walletList}>
            {wallet.entries.slice(0, 8).map((e) => (
              <div key={e.id} className={styles.walletRow}>
                <div>
                  <div className={styles.walletRowLabel}>{e.type === 'EARN' ? 'Cashback earned' : e.type === 'SPEND' ? 'Used at checkout' : 'Adjustment'}</div>
                  <div className={styles.walletRowDate}>{new Date(e.createdAt).toLocaleDateString('en-IN')}</div>
                </div>
                <span className={e.type === 'SPEND' ? styles.walletSpend : styles.walletEarn}>
                  {e.type === 'SPEND' ? '−' : '+'}{inr(e.amount)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.creditNote} style={{ marginTop: 10 }}>
            No wallet activity yet. Buy a product with cashback and it lands here once delivered.
          </div>
        )}
      </Card>

      {onboarding && (
        <Card pad="lg">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusPill label="Onboarding" tone="warning" />
            <span style={{ fontSize: 13, color: 'var(--text2)' }}>
              Your company is pending a company-admin assignment by the platform team.
            </span>
          </div>
        </Card>
      )}

      {/* Credit limit — only when the Super Admin has enabled Smart EPP for the company */}
      {p.smartEppEnabled && (
      <Card pad="lg">
        <div className={styles.cardTitle}>Smart EPP credit limit</div>
        {limit > 0 ? (
          <>
            <div className={styles.creditRow}>
              <span className={styles.creditAvailable}>{inr(available)}</span>
              <span className={styles.creditOf}>available of {inr(limit)}</span>
            </div>
            <div className={styles.bar}>
              <span className={styles.barFill} style={{ width: `${usedPct}%` }} />
            </div>
            <div className={styles.creditNote}>{inr(p.creditUsed)} used</div>
          </>
        ) : (
          <div className={styles.creditNote}>No credit limit set. Ask your HR admin to enable Smart EPP financing.</div>
        )}
      </Card>
      )}

      {/* Shipping addresses */}
      <Card pad="lg">
        <div className={styles.sectionHead}>
          <div className={styles.cardTitle} style={{ marginBottom: 0 }}>Shipping addresses</div>
          <Button size="sm" variant="ghost" icon={<Plus size={15} />} onClick={() => setEditing({ address: null, billing: false })}>
            Add
          </Button>
        </div>
        {shipping.length === 0 && <div className={styles.creditNote}>No saved addresses yet.</div>}
        {shipping.map((a) => (
          <AddressRow
            key={a.id}
            a={a}
            onEdit={() => setEditing({ address: a, billing: false })}
            onDeleted={reload}
          />
        ))}
      </Card>

      {/* Billing address */}
      <Card pad="lg">
        <div className={styles.sectionHead}>
          <div className={styles.cardTitle} style={{ marginBottom: 0 }}>Billing address</div>
          {billing ? (
            <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => setEditing({ address: billing, billing: true })}>
              Edit
            </Button>
          ) : (
            <Button size="sm" variant="ghost" icon={<Plus size={15} />} onClick={() => setEditing({ address: null, billing: true })}>
              Add separate
            </Button>
          )}
        </div>
        {billing ? (
          <AddressRow a={billing} onEdit={() => setEditing({ address: billing, billing: true })} onDeleted={reload} deleteLabel="Same as shipping" />
        ) : (
          <div className={styles.creditNote}>Same as your default shipping address.</div>
        )}
      </Card>

      <Card pad="none">
        {[
          { label: 'Notifications', path: 'notifs' },
          { label: 'About imcorpcart', path: 'about' },
          { label: 'Contact us', path: 'contact' },
        ].map((row) => (
          <button key={row.label} className={styles.settingRow} onClick={() => navigate(`/shop/${row.path}`)}>
            <span>{row.label}</span>
            <ChevronRight size={17} />
          </button>
        ))}
      </Card>

      <Button variant="secondary" block icon={<LogOut size={16} />} onClick={onSignOut}>
        Sign out
      </Button>

      {editing && (
        <AddressModal
          address={editing.address}
          billing={editing.billing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function AddressRow({
  a,
  onEdit,
  onDeleted,
  deleteLabel = 'Delete',
}: {
  a: ShopAddress;
  onEdit: () => void;
  onDeleted: () => void;
  deleteLabel?: string;
}) {
  const { flash } = useToast();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!window.confirm('Remove this address?')) return;
    setBusy(true);
    try {
      await deleteAddress(a.id);
      onDeleted();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not remove address');
      setBusy(false);
    }
  };

  return (
    <div className={styles.addr}>
      <MapPin size={17} />
      <div className={styles.addrBody}>
        <div className={styles.addrTop}>
          <span className={styles.addrLabel}>{a.label || a.contactName}</span>
          {a.isDefault && !a.isBilling && <StatusPill label="Default" tone="info" />}
        </div>
        <div className={styles.addrLine}>{addrLine(a)}</div>
        <div className={styles.addrContact}>{a.contactName} · {a.contactPhone}</div>
        <div className={styles.addrActions}>
          <button className={styles.linkBtn} onClick={onEdit}>
            <Pencil size={13} /> Edit
          </button>
          <button className={styles.linkBtnDanger} onClick={remove} disabled={busy}>
            <Trash2 size={13} /> {deleteLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

