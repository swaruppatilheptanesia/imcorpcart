import { useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ToastProvider, Spinner } from '@/components';
import type { DateRange } from '@/data/types';
import { me, logout as apiLogout, resellerStore } from '@/data/reseller-api';
import { PORTAL_ROLES } from '@/data/unified-auth';
import { Sidebar } from './shell/Sidebar';
import { Topbar } from './shell/Topbar';
import { NewCouponDrawer } from './overlays/NewCouponDrawer';
import type { RSContext } from './context';
import { Performance } from './screens/Performance';
import { Orders } from './screens/Orders';
import { Products } from './screens/Products';
import { ProductEdit } from './screens/ProductEdit';
import { Coupons } from './screens/Coupons';
import { Bulk } from './screens/Bulk';
import styles from './ResellerApp.module.css';

type Stage = 'checking' | 'out' | 'in';

export default function ResellerApp() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>(() => (resellerStore.getToken() ? 'checking' : 'out'));

  // RBAC: only a reseller session opens this console.
  useEffect(() => {
    if (stage !== 'checking') return;
    let cancelled = false;
    me()
      .then((user) => {
        if (cancelled) return;
        if (PORTAL_ROLES.reseller.includes(user.role)) setStage('in');
        else {
          resellerStore.clearAuth();
          setStage('out');
        }
      })
      .catch(() => {
        if (cancelled) return;
        resellerStore.clearAuth();
        setStage('out');
      });
    return () => {
      cancelled = true;
    };
  }, [stage]);

  useEffect(() => {
    const onExpired = () => setStage('out');
    window.addEventListener(resellerStore.expiredEvent, onExpired);
    return () => window.removeEventListener(resellerStore.expiredEvent, onExpired);
  }, []);

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
      <Console
        onSignOut={() => {
          void apiLogout();
          navigate('/');
        }}
      />
    </ToastProvider>
  );
}

function Console({ onSignOut }: { onSignOut: () => void }) {
  const location = useLocation();
  const [dateRange, setDateRange] = useState<DateRange>('30D');
  const [couponOpen, setCouponOpen] = useState(false);

  const route = location.pathname.split('/').filter(Boolean)[1] ?? 'dashboard';

  useEffect(() => {
    setCouponOpen(false);
  }, [route]);

  // Resellers no longer create products (the Super Admin authors them); they
  // only edit their price/stock listings. So only Coupons has a create action.
  const actionLabel = route === 'coupons' ? 'New coupon' : undefined;
  const onAction = () => {
    if (route === 'coupons') setCouponOpen(true);
  };

  const ctx: RSContext = { dateRange, setDateRange, openCoupon: () => setCouponOpen(true) };

  return (
    <div className={styles.page}>
      <Sidebar route={route} onSignOut={onSignOut} />
      <div className={styles.frame}>
        <Topbar
          route={route}
          dateRange={dateRange}
          onDateRange={setDateRange}
          actionLabel={actionLabel}
          onAction={onAction}
        />
        <main className={styles.scroll}>
          <div className={styles.inner}>
            <Routes>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route element={<Outlet context={ctx} />}>
                <Route path="dashboard" element={<Performance />} />
                <Route path="orders" element={<Orders />} />
                <Route path="products" element={<Products />} />
                <Route path="productEdit" element={<ProductEdit />} />
                <Route path="coupons" element={<Coupons />} />
                <Route path="bulk" element={<Bulk />} />
                <Route path="*" element={<Navigate to="dashboard" replace />} />
              </Route>
            </Routes>
          </div>
        </main>
      </div>
      <NewCouponDrawer open={couponOpen} onClose={() => setCouponOpen(false)} />
    </div>
  );
}
