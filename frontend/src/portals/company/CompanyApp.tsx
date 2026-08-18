import { useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ToastProvider, Spinner } from '@/components';
import {
  logout as apiLogout,
  me,
  getProfile,
  companyStore,
  type CompanyProfile,
  type CompanyEmployee,
} from '@/data/company-api';
import { PORTAL_ROLES } from '@/data/unified-auth';
import { Sidebar } from './shell/Sidebar';
import { Topbar } from './shell/Topbar';
import { EmployeeDrawer } from './overlays/EmployeeDrawer';
import type { CompanyContext } from './context';
import { Dashboard } from './screens/Dashboard';
import { Employees } from './screens/Employees';
import { Orders } from './screens/Orders';
import { Profile } from './screens/Profile';
import styles from '../super-admin/SuperAdminApp.module.css';

type Stage = 'checking' | 'out' | 'in';

export default function CompanyApp() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>(() => (companyStore.getToken() ? 'checking' : 'out'));

  // RBAC: only a company-role session opens this console.
  useEffect(() => {
    if (stage !== 'checking') return;
    let cancelled = false;
    me()
      .then((user) => {
        if (cancelled) return;
        if (PORTAL_ROLES.company.includes(user.role)) setStage('in');
        else {
          companyStore.clearAuth();
          setStage('out');
        }
      })
      .catch(() => {
        if (cancelled) return;
        companyStore.clearAuth();
        setStage('out');
      });
    return () => {
      cancelled = true;
    };
  }, [stage]);

  useEffect(() => {
    const onExpired = () => setStage('out');
    window.addEventListener(companyStore.expiredEvent, onExpired);
    return () => window.removeEventListener(companyStore.expiredEvent, onExpired);
  }, []);

  const signOut = () => {
    void apiLogout();
    navigate('/');
  };

  if (stage === 'checking') {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <Spinner size={28} />
      </div>
    );
  }
  // Single door: signed-out (or wrong-role) visits go to the unified login.
  if (stage !== 'in') return <Navigate to="/" replace />;

  return (
    <ToastProvider>
      <Console onSignOut={signOut} />
    </ToastProvider>
  );
}

function Console({ onSignOut }: { onSignOut: () => void }) {
  const location = useLocation();
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [drawer, setDrawer] = useState<{ open: boolean; employee: CompanyEmployee | null }>({
    open: false,
    employee: null,
  });
  const [employeesVersion, setEmployeesVersion] = useState(0);

  const route = location.pathname.split('/').filter(Boolean)[1] ?? 'dashboard';

  useEffect(() => {
    let cancelled = false;
    getProfile()
      .then((p) => !cancelled && setProfile(p))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const ctx: CompanyContext = {
    profile,
    employeesVersion,
    openAddEmployee: () => setDrawer({ open: true, employee: null }),
    openEditEmployee: (employee) => setDrawer({ open: true, employee }),
  };
  const actionLabel = route === 'employees' ? 'Add employee' : undefined;

  return (
    <div className={styles.page}>
      <Sidebar
        route={route}
        companyName={profile?.name ?? ''}
        adminName={profile?.adminName ?? ''}
        onSignOut={onSignOut}
      />
      <div className={styles.frame}>
        <Topbar route={route} actionLabel={actionLabel} onAction={() => setDrawer({ open: true, employee: null })} />
        <main className={styles.scroll}>
          <div className={styles.inner}>
            <Routes>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route element={<Outlet context={ctx} />}>
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="employees" element={<Employees />} />
                <Route path="orders" element={<Orders />} />
                <Route path="profile" element={<Profile />} />
                <Route path="*" element={<Navigate to="dashboard" replace />} />
              </Route>
            </Routes>
          </div>
        </main>
      </div>
      <EmployeeDrawer
        open={drawer.open}
        employee={drawer.employee}
        onClose={() => setDrawer({ open: false, employee: null })}
        onSaved={() => {
          setDrawer({ open: false, employee: null });
          setEmployeesVersion((v) => v + 1);
        }}
      />
    </div>
  );
}
