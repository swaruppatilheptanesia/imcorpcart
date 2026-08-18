import { useEffect, useState } from 'react';
import { UploadCloud, Plus, AlertTriangle, Users as UsersIcon } from 'lucide-react';
import {
  Segmented,
  Button,
  DataTable,
  Row,
  Avatar,
  StatusPill,
  Field,
  Input,
  Modal,
  Toggle,
  Skeleton,
  EmptyState,
  useToast,
} from '@/components';
import {
  getUsers,
  inviteUser,
  createCompany,
  assignCompanyAdmin,
  updateUser,
  updateReseller,
  updateCompany,
  userTabLabels,
  addUserLabel,
} from '@/data/api';
import type { UserState, UserTab, SemanticTone } from '@/data/types';
import type { UserRowWithId } from '@/data/map';
import { useAsync } from '@/lib/useAsync';
import s from './screen.module.css';
import styles from './Users.module.css';

const COLS = '2fr 1.3fr 1.6fr 1fr 1.4fr';

const stateTone: Record<UserState, SemanticTone> = {
  Active: 'success',
  Suspended: 'error',
  Invited: 'neutral',
  Pending: 'warning',
};

// The three states the Super Admin can set from the per-row status control.
type SettableStatus = 'ACTIVE' | 'PENDING' | 'SUSPENDED';
const STATUS_LABEL: Record<SettableStatus, string> = {
  ACTIVE: 'Active',
  PENDING: 'Pending',
  SUSPENDED: 'Suspended',
};
// Current display state → the matching settable value (Invited has no direct one).
const stateToStatus = (st: UserState): SettableStatus | 'INVITED' =>
  st === 'Active' ? 'ACTIVE' : st === 'Pending' ? 'PENDING' : st === 'Suspended' ? 'SUSPENDED' : 'INVITED';

// Company approval status (OrgStatus). ONBOARDING is the "pending approval"
// state — a company can't log in until a Super Admin sets it ACTIVE.
type CompanySettableStatus = 'ACTIVE' | 'ONBOARDING' | 'SUSPENDED';
const COMPANY_STATUS_LABEL: Record<CompanySettableStatus, string> = {
  ACTIVE: 'Active',
  ONBOARDING: 'Pending',
  SUSPENDED: 'Suspended',
};
const stateToCompanyStatus = (st: UserState): CompanySettableStatus =>
  st === 'Active' ? 'ACTIVE' : st === 'Suspended' ? 'SUSPENDED' : 'ONBOARDING';

const TABS: { value: UserTab; label: string }[] = (
  ['companies', 'employees', 'resellers', 'partners'] as UserTab[]
).map((t) => ({ value: t, label: userTabLabels[t] }));

const emptyForm = {
  name: '',
  email: '',
  companyId: '',
  gstin: '',
  emailDomain: '',
  adminName: '',
  adminEmail: '',
  // reseller onboarding
  pan: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  pincode: '',
  commission: '',
  smartEpp: false,
};

export function UsersScreen() {
  const { flash } = useToast();
  const [tab, setTab] = useState<UserTab>('companies');
  const [modal, setModal] = useState<'add' | 'import' | 'assign' | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [assignTarget, setAssignTarget] = useState<{ id: string; name: string } | null>(null);
  const [assignForm, setAssignForm] = useState({ adminName: '', adminEmail: '' });
  const [editReseller, setEditReseller] = useState<{ id: string; name: string; commission: string } | null>(null);
  const [editCompany, setEditCompany] = useState<{ id: string; name: string; smartEpp: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: ds, state, error, reload } = useAsync(
    () => getUsers(tab),
    [tab],
    (d) => d.rows.length === 0,
  );

  useEffect(() => setForm(emptyForm), [tab, modal]);

  const sendInvite = async () => {
    setBusy(true);
    try {
      if (tab === 'companies') {
        if (!form.name.trim() || !form.adminName.trim() || !form.adminEmail.trim()) {
          flash('Company name, admin name and admin email are required');
          setBusy(false);
          return;
        }
        const res = await createCompany({
          companyName: form.name.trim(),
          gstin: form.gstin.trim() || undefined,
          emailDomain: form.emailDomain.trim() || undefined,
          adminName: form.adminName.trim(),
          adminEmail: form.adminEmail.trim(),
          smartEppEnabled: form.smartEpp,
        });
        flash(res.tempPassword ? `Company created · admin password: ${res.tempPassword}` : 'Company created');
      } else {
        if (!form.name.trim() || !form.email.trim()) {
          flash('Name and email are required');
          setBusy(false);
          return;
        }
        if (tab === 'employees' && !form.companyId.trim()) {
          flash('Employee invites need a company id');
          setBusy(false);
          return;
        }
        await inviteUser({
          type: tab,
          name: form.name.trim(),
          email: form.email.trim(),
          companyId: tab === 'employees' ? form.companyId.trim() : undefined,
          ...(tab === 'resellers'
            ? {
                gstin: form.gstin.trim() || undefined,
                pan: form.pan.trim() || undefined,
                phone: form.phone.trim() || undefined,
                addressLine1: form.addressLine1.trim() || undefined,
                addressLine2: form.addressLine2.trim() || undefined,
                city: form.city.trim() || undefined,
                state: form.state.trim() || undefined,
                pincode: form.pincode.trim() || undefined,
                commissionPct: form.commission.trim() ? Number(form.commission) : undefined,
              }
            : {}),
        });
        flash('Invitation sent');
      }
      setModal(null);
      reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const saveCommission = async () => {
    if (!editReseller) return;
    setBusy(true);
    try {
      await updateReseller(editReseller.id, { commissionPct: Number(editReseller.commission) || 0 });
      flash('Commission updated');
      setEditReseller(null);
      reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not update commission');
    } finally {
      setBusy(false);
    }
  };

  const saveCompany = async () => {
    if (!editCompany) return;
    setBusy(true);
    try {
      await updateCompany(editCompany.id, { smartEppEnabled: editCompany.smartEpp });
      flash(`Smart EPP ${editCompany.smartEpp ? 'enabled' : 'disabled'} for ${editCompany.name}`);
      setEditCompany(null);
      reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not update company');
    } finally {
      setBusy(false);
    }
  };

  // Super Admin can move an account to any of Active / Pending / Suspended.
  const setStatus = async (row: UserRowWithId, next: SettableStatus) => {
    if (!row.userId) return;
    try {
      await updateUser(row.userId, { status: next });
      flash(`Status set to ${STATUS_LABEL[next]}`);
      reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Update failed');
    }
  };

  // Approve / suspend a COMPANY (OrgStatus). ONBOARDING = pending; the company's
  // users can't log in until it's set Active.
  const setCompanyStatus = async (row: UserRowWithId, next: CompanySettableStatus) => {
    try {
      await updateCompany(row.id, { status: next });
      flash(`Company set to ${COMPANY_STATUS_LABEL[next]}`);
      reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Update failed');
    }
  };

  const submitAssign = async () => {
    if (!assignTarget) return;
    if (!assignForm.adminName.trim() || !assignForm.adminEmail.trim()) {
      flash('Admin name and email are required');
      return;
    }
    setBusy(true);
    try {
      const res = await assignCompanyAdmin(assignTarget.id, {
        adminName: assignForm.adminName.trim(),
        adminEmail: assignForm.adminEmail.trim(),
      });
      flash(res.tempPassword ? `Admin assigned · password: ${res.tempPassword}` : 'Admin assigned');
      setModal(null);
      setAssignTarget(null);
      setAssignForm({ adminName: '', adminEmail: '' });
      reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not assign admin');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className={s.toolbar}>
        <Segmented options={TABS} value={tab} onChange={setTab} />
        <div className={s.spacer} />
        <Button variant="secondary" size="sm" icon={<UploadCloud size={16} />} onClick={() => setModal('import')}>
          Import CSV
        </Button>
        <Button size="sm" icon={<Plus size={16} strokeWidth={2.2} />} onClick={() => setModal('add')}>
          {addUserLabel[tab]}
        </Button>
      </div>

      {state === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} h={52} />
          ))}
        </div>
      )}

      {state === 'error' && (
        <EmptyState
          tone="error"
          icon={<AlertTriangle size={24} />}
          title="Couldn't load users"
          body={error ?? 'Something went wrong.'}
          action={{ label: 'Retry', onClick: reload }}
        />
      )}

      {state === 'empty' && (
        <EmptyState
          icon={<UsersIcon size={24} />}
          title="No records yet"
          body={`No ${userTabLabels[tab].toLowerCase()} here. Add one to get started.`}
          action={{ label: addUserLabel[tab], onClick: () => setModal('add') }}
        />
      )}

      {state === 'live' && ds && (
        <DataTable cols={COLS} headers={ds.headers}>
          {ds.rows.map((u, i) => {
            const row = u as UserRowWithId;
            const canAssign = tab === 'companies' && !row.userId;
            return (
              <Row key={`${u.name}-${i}`} cols={COLS}>
                <div className={s.cellMain}>
                  <Avatar initials={u.initials} size={36} bg={u.avBg} />
                  <div className={s.cellName}>{u.name}</div>
                </div>
                <div className={s.muted}>{u.meta1}</div>
                <div className={s.muted}>{u.meta2}</div>
                <div>
                  <StatusPill label={u.state} tone={stateTone[u.state]} />
                </div>
                <div className={styles.actions} style={{ justifyContent: 'flex-end', display: 'flex', gap: 8 }}>
                  {tab === 'resellers' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setEditReseller({ id: row.id, name: u.name, commission: String(row.commissionPct ?? 0) })
                      }
                    >
                      Commission
                    </Button>
                  )}
                  {tab === 'companies' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setEditCompany({ id: row.id, name: u.name, smartEpp: Boolean(row.smartEppEnabled) })
                      }
                    >
                      Smart EPP: {row.smartEppEnabled ? 'On' : 'Off'}
                    </Button>
                  )}
                  {/* Companies: assign an admin (if none), plus the company
                      approval-status control (governs whether its users can log in). */}
                  {tab === 'companies' && (
                    <>
                      {canAssign && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setAssignTarget({ id: row.id, name: u.name });
                            setModal('assign');
                          }}
                        >
                          Assign admin
                        </Button>
                      )}
                      <select
                        className={styles.statusSelect}
                        value={stateToCompanyStatus(u.state)}
                        onChange={(e) => setCompanyStatus(row, e.target.value as CompanySettableStatus)}
                        aria-label="Company approval status"
                      >
                        <option value="ACTIVE">Active</option>
                        <option value="ONBOARDING">Pending</option>
                        <option value="SUSPENDED">Suspended</option>
                      </select>
                    </>
                  )}
                  {/* Employees / resellers / partners: per-user account status. */}
                  {tab !== 'companies' &&
                    (row.userId ? (
                      <select
                        className={styles.statusSelect}
                        value={stateToStatus(u.state)}
                        onChange={(e) => setStatus(row, e.target.value as SettableStatus)}
                        aria-label="Account status"
                      >
                        {stateToStatus(u.state) === 'INVITED' && (
                          <option value="INVITED" disabled>Invited</option>
                        )}
                        <option value="ACTIVE">Active</option>
                        <option value="PENDING">Pending</option>
                        <option value="SUSPENDED">Suspended</option>
                      </select>
                    ) : (
                      <span className={s.muted}>—</span>
                    ))}
                </div>
              </Row>
            );
          })}
        </DataTable>
      )}

      {/* Add user / company modal */}
      <Modal
        open={modal === 'add'}
        onClose={() => setModal(null)}
        title={addUserLabel[tab]}
        width={tab === 'resellers' ? 620 : 460}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={sendInvite} disabled={busy}>
              {busy ? 'Saving…' : tab === 'companies' ? 'Create company' : 'Send invite'}
            </Button>
          </>
        }
      >
        {tab === 'companies' ? (
          <>
            <Field label="Company name">
              <Input placeholder="Acme Corp" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="GSTIN" hint="Optional">
              <Input placeholder="29AABCA5678B1Z2" value={form.gstin} onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value }))} />
            </Field>
            <Field label="Email domain" hint="Employees on this domain auto-join (defaults from admin email)">
              <Input placeholder="acme.com" value={form.emailDomain} onChange={(e) => setForm((f) => ({ ...f, emailDomain: e.target.value }))} />
            </Field>
            <Field label="Company admin name" hint="Gets access to the company (HR) portal">
              <Input placeholder="Full name" value={form.adminName} onChange={(e) => setForm((f) => ({ ...f, adminName: e.target.value }))} />
            </Field>
            <Field label="Company admin email">
              <Input type="email" placeholder="admin@acme.com" value={form.adminEmail} onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))} />
            </Field>
            <Field label="Smart EPP" hint="Show the Smart EPP / EMI option to this company's employees">
              <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Toggle on={form.smartEpp} onClick={() => setForm((f) => ({ ...f, smartEpp: !f.smartEpp }))} />
                <span style={{ fontSize: 13 }}>{form.smartEpp ? 'Enabled' : 'Disabled'}</span>
              </label>
            </Field>
          </>
        ) : tab === 'resellers' ? (
          <>
            <div className={s.formRow2}>
              <Field label="Name">
                <Input placeholder="Reseller name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </Field>
              <Field label="Email">
                <Input type="email" placeholder="sales@vendor.com" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </Field>
            </div>
            <div className={s.formRow}>
              <Field label="GSTIN" hint="15-character GST number">
                <Input placeholder="29AABCA5678B1Z2" value={form.gstin} onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value }))} />
              </Field>
              <Field label="PAN" hint="Format AAAAA9999A">
                <Input placeholder="AABCA5678B" value={form.pan} onChange={(e) => setForm((f) => ({ ...f, pan: e.target.value }))} />
              </Field>
              <Field label="Commission %" hint="Platform cut">
                <Input placeholder="8" inputMode="decimal" value={form.commission} onChange={(e) => setForm((f) => ({ ...f, commission: e.target.value.replace(/[^0-9.]/g, '') }))} />
              </Field>
            </div>
            <div className={s.formRow2}>
              <Field label="Contact phone" hint="Optional">
                <Input placeholder="+91 98765 43210" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </Field>
              <Field label="Address line 1">
                <Input placeholder="Building, street" value={form.addressLine1} onChange={(e) => setForm((f) => ({ ...f, addressLine1: e.target.value }))} />
              </Field>
            </div>
            <Field label="Address line 2" hint="Optional">
              <Input placeholder="Area, landmark" value={form.addressLine2} onChange={(e) => setForm((f) => ({ ...f, addressLine2: e.target.value }))} />
            </Field>
            <div className={s.formRow}>
              <Field label="City">
                <Input placeholder="Mumbai" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
              </Field>
              <Field label="State">
                <Input placeholder="Maharashtra" value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} />
              </Field>
              <Field label="Pincode">
                <Input placeholder="400001" value={form.pincode} onChange={(e) => setForm((f) => ({ ...f, pincode: e.target.value }))} />
              </Field>
            </div>
          </>
        ) : (
          <>
            <Field label="Name">
              <Input placeholder="Full name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="Email">
              <Input type="email" placeholder="name@company.com" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </Field>
            {tab === 'employees' && (
              <Field label="Company ID" hint="The company this employee belongs to">
                <Input placeholder="cmr…" value={form.companyId} onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))} />
              </Field>
            )}
          </>
        )}
      </Modal>

      {/* Edit reseller commission modal */}
      <Modal
        open={Boolean(editReseller)}
        onClose={() => setEditReseller(null)}
        title={`Commission — ${editReseller?.name ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditReseller(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={saveCommission} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <Field label="Commission %" hint="Platform cut on this reseller's sales (0–100)">
          <Input
            placeholder="8"
            inputMode="decimal"
            value={editReseller?.commission ?? ''}
            onChange={(e) =>
              setEditReseller((r) => (r ? { ...r, commission: e.target.value.replace(/[^0-9.]/g, '') } : r))
            }
          />
        </Field>
      </Modal>

      {/* Edit company — Smart EPP enablement */}
      <Modal
        open={Boolean(editCompany)}
        onClose={() => setEditCompany(null)}
        title={`Smart EPP — ${editCompany?.name ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditCompany(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={saveCompany} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Enable Smart EPP (EMI)</div>
            <div className={s.muted} style={{ fontSize: 12.5, marginTop: 2 }}>
              When on, this company's employees see the Smart EPP / EMI option at checkout.
            </div>
          </div>
          <Toggle
            on={editCompany?.smartEpp ?? false}
            onClick={() => setEditCompany((c) => (c ? { ...c, smartEpp: !c.smartEpp } : c))}
          />
        </div>
      </Modal>

      {/* Assign admin modal */}
      <Modal
        open={modal === 'assign'}
        onClose={() => setModal(null)}
        title={`Assign admin — ${assignTarget?.name ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submitAssign} disabled={busy}>
              {busy ? 'Assigning…' : 'Assign admin'}
            </Button>
          </>
        }
      >
        <p style={{ fontSize: 13, color: 'var(--text3)', marginTop: 0 }}>
          This company was created by self-registration and has no admin. Grant company-admin rights so
          they can access the company portal.
        </p>
        <Field label="Admin name">
          <Input placeholder="Full name" value={assignForm.adminName} onChange={(e) => setAssignForm((f) => ({ ...f, adminName: e.target.value }))} />
        </Field>
        <Field label="Admin email">
          <Input type="email" placeholder="hr@company.com" value={assignForm.adminEmail} onChange={(e) => setAssignForm((f) => ({ ...f, adminEmail: e.target.value }))} />
        </Field>
      </Modal>

      {/* Import modal */}
      <Modal
        open={modal === 'import'}
        onClose={() => setModal(null)}
        title="Import from CSV"
        width={500}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setModal(null);
                flash('CSV import is available via the API — parse rows and POST to /users/import.');
              }}
            >
              Close
            </Button>
          </>
        }
      >
        <div className={styles.dropzone}>
          <UploadCloud size={26} />
          <div className={styles.dropTitle}>Drop a CSV file here</div>
          <div className={styles.dropSub}>or click to browse · max 5MB</div>
        </div>
      </Modal>
    </div>
  );
}
