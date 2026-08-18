import { useEffect, useState } from 'react';
import { Drawer, Field, Input, Button, useToast } from '@/components';
import { createEmployee, updateEmployee, type CompanyEmployee } from '@/data/company-api';

interface Props {
  open: boolean;
  employee: CompanyEmployee | null;
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  fullName: string;
  email: string;
  employeeCode: string;
  department: string;
  creditLimit: string;
}

const empty: FormState = { fullName: '', email: '', employeeCode: '', department: '', creditLimit: '' };

const num = (v: string): number | undefined => {
  const n = Number(v.replace(/[^0-9.]/g, ''));
  return v.trim() && !Number.isNaN(n) ? n : undefined;
};

export function EmployeeDrawer({ open, employee, onClose, onSaved }: Props) {
  const { flash } = useToast();
  const isEdit = Boolean(employee);
  const [form, setForm] = useState<FormState>(empty);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      employee
        ? {
            fullName: employee.name,
            email: employee.email,
            employeeCode: employee.employeeCode,
            department: employee.department ?? '',
            creditLimit: employee.creditLimit === null ? '' : String(employee.creditLimit),
          }
        : empty,
    );
  }, [open, employee]);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!isEdit && (!form.fullName.trim() || !form.email.trim())) {
      flash('Name and email are required');
      return;
    }
    setBusy(true);
    try {
      if (isEdit && employee) {
        await updateEmployee(employee.id, {
          department: form.department.trim() || undefined,
          creditLimit: form.creditLimit.trim() === '' ? null : num(form.creditLimit),
        });
        flash('Employee updated');
      } else {
        const res = await createEmployee({
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          employeeCode: form.employeeCode.trim() || undefined,
          department: form.department.trim() || undefined,
          creditLimit: num(form.creditLimit),
        });
        flash(res.tempPassword ? `Employee added · temp password: ${res.tempPassword}` : 'Employee added');
      }
      onSaved();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit employee' : 'Add employee'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add employee'}
          </Button>
        </>
      }
    >
      <Field label="Full name">
        <Input placeholder="Employee name" value={form.fullName} onChange={set('fullName')} disabled={isEdit} />
      </Field>
      <Field label="Work email" hint={isEdit ? 'Email cannot be changed' : 'Used to sign in to the storefront'}>
        <Input type="email" placeholder="name@company.com" value={form.email} onChange={set('email')} disabled={isEdit} />
      </Field>
      {!isEdit && (
        <Field label="Employee code" hint="Optional — auto-generated if blank">
          <Input placeholder="EMP-001" value={form.employeeCode} onChange={set('employeeCode')} />
        </Field>
      )}
      <Field label="Department">
        <Input placeholder="Engineering" value={form.department} onChange={set('department')} />
      </Field>
      <Field label="Credit limit (annual salary)" hint="Caps Smart EPP financing for this employee">
        <Input placeholder="e.g. 1200000" value={form.creditLimit} onChange={set('creditLimit')} />
      </Field>
      {!isEdit && (
        <p style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 6 }}>
          The employee is created as active with a temporary password (shown after saving).
        </p>
      )}
    </Drawer>
  );
}
