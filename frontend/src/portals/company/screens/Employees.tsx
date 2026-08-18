import { AlertTriangle, Users as UsersIcon, Pencil } from 'lucide-react';
import {
  Button,
  DataTable,
  Row,
  Avatar,
  StatusPill,
  Skeleton,
  EmptyState,
  useToast,
} from '@/components';
import { getEmployees, updateEmployee, type CompanyEmployee } from '@/data/company-api';
import type { SemanticTone } from '@/data/types';
import { useAsync } from '@/lib/useAsync';
import { inr } from '@/lib/format';
import { useCompany } from '../context';
import s from '../../super-admin/screens/screen.module.css';

const COLS = '2fr 1.4fr 1.2fr 1fr 1.3fr';

const tone: Record<string, SemanticTone> = {
  ACTIVE: 'success',
  SUSPENDED: 'error',
  INVITED: 'neutral',
  DISABLED: 'error',
};

const initialsOf = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

export function Employees() {
  const { flash } = useToast();
  const { openAddEmployee, openEditEmployee, employeesVersion } = useCompany();
  const { data, state, error, reload } = useAsync(
    () => getEmployees(),
    [employeesVersion],
    (d) => d.length === 0,
  );

  const toggleStatus = async (e: CompanyEmployee) => {
    const next = e.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    try {
      await updateEmployee(e.id, { status: next });
      flash(next === 'ACTIVE' ? 'Employee activated' : 'Employee suspended');
      reload();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Update failed');
    }
  };

  return (
    <div>
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
          title="Couldn't load employees"
          body={error ?? 'Something went wrong.'}
          action={{ label: 'Retry', onClick: reload }}
        />
      )}

      {state === 'empty' && (
        <EmptyState
          icon={<UsersIcon size={24} />}
          title="No employees yet"
          body="Add your first employee to enrol them in the purchase program."
          action={{ label: 'Add employee', onClick: openAddEmployee }}
        />
      )}

      {state === 'live' && data && (
        <DataTable cols={COLS} headers={['Employee', 'Code · Department', 'Credit limit', 'Status', '']}>
          {data.map((e) => (
            <Row key={e.id} cols={COLS}>
              <div className={s.cellMain}>
                <Avatar initials={initialsOf(e.name)} size={36} />
                <div>
                  <div className={s.cellName}>{e.name}</div>
                  <div className={s.cellSub}>{e.email}</div>
                </div>
              </div>
              <div className={s.muted}>
                <span className={s.mono}>{e.employeeCode}</span>
                {e.department ? ` · ${e.department}` : ''}
              </div>
              <div className={s.price}>{e.creditLimit === null ? '—' : inr(e.creditLimit)}</div>
              <div>
                <StatusPill label={e.status} tone={tone[e.status] ?? 'neutral'} />
              </div>
              <div className={s.rowActions} style={{ justifyContent: 'flex-end' }}>
                <button className={s.iconBtn} onClick={() => openEditEmployee(e)} aria-label="Edit">
                  <Pencil size={16} />
                </button>
                <Button variant="secondary" size="sm" onClick={() => toggleStatus(e)}>
                  {e.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                </Button>
              </div>
            </Row>
          ))}
        </DataTable>
      )}
    </div>
  );
}
