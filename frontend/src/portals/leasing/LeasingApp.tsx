import { useCallback, useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ToastProvider, Spinner } from '@/components';
import { logout as apiLogout, me, getProfile, leasingStore, type LeasingProfile } from '@/data/leasing-api';
import { PORTAL_ROLES } from '@/data/unified-auth';
import { Sidebar } from './shell/Sidebar';
import { Topbar } from './shell/Topbar';
import type { LeasingContext } from './context';
import { Dashboard } from './screens/Dashboard';
import { Requests } from './screens/Requests';
import { Companies } from './screens/Companies';
import { Settings } from './screens/Settings';
import styles from '../super-admin/SuperAdminApp.module.css';

type Stage = 'checking' | 'out' | 'in';

/** Leasing-company portal — the fifth portal. Stage 2 of the Smart EPP approval
 *  chain: tune lease parameters, review HR-approved requests, approve to finance
 *  (which creates the orders) or reject (which refunds the employee's advance). */
export default function LeasingApp() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>(() => (leasingStore.getToken() ? 'checking' : 'out'));

  useEffect(() => {
    if (stage !== 'checking') return;
    let cancelled = false;
    me()
      .then((user) => {
        if (cancelled) return;
        if (PORTAL_ROLES.leasing.includes(user.role)) setStage('in');
        else {
          leasingStore.clearAuth();
          setStage('out');
        }
      })
      .catch(() => {
        if (cancelled) return;
        leasingStore.clearAuth();
        setStage('out');
      });
    return () => {
      cancelled = true;
    };
  }, [stage]);

  useEffect(() => {
    const onExpired = () => setStage('out');
    window.addEventListener(leasingStore.expiredEvent, onExpired);
    return () => window.removeEventListener(leasingStore.expiredEvent, onExpired);
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
  if (stage !== 'in') return <Navigate to="/" replace />;

  return (
    <ToastProvider>
      <Console onSignOut={signOut} />
    </ToastProvider>
  );
}

function Console({ onSignOut }: { onSignOut: () => void }) {
  const location = useLocation();
  const [profile, setProfile] = useState<LeasingProfile | null>(null);
  const route = location.pathname.split('/').filter(Boolean)[1] ?? 'dashboard';

  const refreshProfile = useCallback(() => {
    getProfile()
      .then(setProfile)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  const ctx: LeasingContext = { profile, refreshProfile };

  return (
    <div className={styles.page}>
      <Sidebar
        route={route}
        companyName={profile?.name ?? ''}
        operatorName={profile?.operator?.name ?? ''}
        onSignOut={onSignOut}
      />
      <div className={styles.frame}>
        <Topbar route={route} />
        <main className={styles.scroll}>
          <div className={styles.inner}>
            <Routes>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route element={<Outlet context={ctx} />}>
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="requests" element={<Requests />} />
                <Route path="companies" element={<Companies />} />
                <Route path="settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="dashboard" replace />} />
              </Route>
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}
