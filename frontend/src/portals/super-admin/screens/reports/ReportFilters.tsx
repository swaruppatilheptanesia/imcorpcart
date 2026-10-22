import { Field, Input, Select } from '@/components';
import type { ReportFilterField, ReportFilterValues } from '@/data/api';
import styles from './reports.module.css';

/**
 * Renders whatever filter controls the server declared for a report.
 *
 * Deliberately knows nothing about any particular report: a new filter is a
 * `FilterFieldDef` in the descriptor, not a change here. The repo has no
 * date-picker component, and none is needed — `Input` spreads its attributes,
 * so `type="date"` is a native picker in house styling.
 */

const PERIODS: { value: string; label: string }[] = [
  { value: 'DAY', label: 'Today' },
  { value: 'WEEK', label: 'This week' },
  { value: 'MONTH', label: 'This month' },
  { value: 'QUARTER', label: 'This quarter' },
  { value: 'YEAR', label: 'This year' },
  { value: 'CUSTOM', label: 'Custom range…' },
  { value: 'ALL', label: 'All time' },
];

export function ReportFilters({
  fields,
  values,
  onChange,
}: {
  fields: ReportFilterField[];
  values: ReportFilterValues;
  onChange: (patch: ReportFilterValues) => void;
}) {
  return (
    <div className={styles.filters}>
      {fields.map((f) => {
        if (f.kind === 'period') {
          const current = values[f.key] ?? 'ALL';
          return (
            <div key={f.key} className={styles.periodGroup}>
              <Field label={f.label}>
                <Select value={current} onChange={(e) => onChange({ [f.key]: e.target.value })}>
                  {PERIODS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {current === 'CUSTOM' && (
                <>
                  <Field label="From">
                    <Input
                      type="date"
                      value={values.from ?? ''}
                      onChange={(e) => onChange({ from: e.target.value })}
                    />
                  </Field>
                  <Field label="To">
                    <Input type="date" value={values.to ?? ''} onChange={(e) => onChange({ to: e.target.value })} />
                  </Field>
                </>
              )}
            </div>
          );
        }
        return (
          <Field key={f.key} label={f.label}>
            <Select value={values[f.key] ?? 'all'} onChange={(e) => onChange({ [f.key]: e.target.value })}>
              <option value="all">{f.allLabel ?? 'All'}</option>
              {(f.options ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        );
      })}
    </div>
  );
}
