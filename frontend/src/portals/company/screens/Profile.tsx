import { AlertTriangle } from 'lucide-react';
import { Card, Skeleton, StatusPill, EmptyState } from '@/components';
import { getProfile } from '@/data/company-api';
import type { SemanticTone } from '@/data/types';
import { useAsync } from '@/lib/useAsync';
import s from '../../super-admin/screens/screen.module.css';

const tone: Record<string, SemanticTone> = {
  ACTIVE: 'success',
  SUSPENDED: 'error',
  ONBOARDING: 'warning',
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

export function Profile() {
  const { data, state, error, reload } = useAsync(() => getProfile(), []);

  if (state === 'loading') return <Skeleton h={320} />;
  if (state === 'error')
    return (
      <EmptyState
        tone="error"
        icon={<AlertTriangle size={24} />}
        title="Couldn't load company"
        body={error ?? 'Something went wrong.'}
        action={{ label: 'Retry', onClick: reload }}
      />
    );
  if (!data) return null;

  return (
    <div className={s.narrow}>
      <Card style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <h2 className={s.sectionTitle} style={{ margin: 0 }}>
            {data.name}
          </h2>
          <StatusPill label={data.status} tone={tone[data.status] ?? 'neutral'} />
        </div>
        <Field label="GSTIN" value={data.gstin ?? '—'} />
        <Field label="Email domain" value={data.emailDomain ?? '— (employees join by invite)'} />
        <Field label="Company admin" value={data.adminName ? `${data.adminName} · ${data.adminEmail}` : '—'} />
        <Field label="Employees enrolled" value={String(data.employeeCount)} />
        <Field label="Purchase program" value="EPP (Employee Purchase Program)" />
      </Card>
    </div>
  );
}
