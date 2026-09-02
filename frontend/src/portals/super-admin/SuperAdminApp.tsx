import { useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ToastProvider, Spinner } from '@/components';
import type { DateRange } from '@/data/types';
import { logout as apiLogout, me } from '@/data/api';
import { getToken, clearAuth, AUTH_EXPIRED_EVENT } from '@/data/auth-store';
import { PORTAL_ROLES } from '@/data/unified-auth';
import { Sidebar } from './shell/Sidebar';
import { Topbar } from './shell/Topbar';
import type { SAContext } from './context';
import { Dashboard } from './screens/Dashboard';
import { Products } from './screens/Products';
import { ProductDetail } from './screens/ProductDetail';
import { ProductEdit } from './screens/ProductEdit';
import { Orders } from './screens/Orders';
import { OrderDetail } from './screens/OrderDetail';
import { UsersScreen } from './screens/Users';
import { Reviews } from './screens/Reviews';
import { ResellerPricing } from './screens/ResellerPricing';
import { Categories } from './screens/Categories';
import { Pincodes } from './screens/Pincodes';
import { Partners } from './screens/Partners';
import { PartnerDetail } from './screens/PartnerDetail';
import { QrCampaigns } from './screens/QrCampaigns';
import { Banners } from './screens/Banners';
import { Payments } from './screens/Payments';
import { Reports } from './screens/Reports';
import { Bulk } from './screens/Bulk';
import styles from './SuperAdminApp.module.css';

type Stage = 'checking' | 'out' | 'in';

export default function SuperAdminApp() {
  const navigate = useNavigate();
  // Start in 'checking' if a token exists (validate it), else redirect to `/`.
  const [stage, setStage] = useState<Stage>(() => (getToken() ? 'checking' : 'out'));

  // Validate a stored token on mount so a refresh stays signed in. RBAC: only
  // an admin-role session opens this console — anything else is bounced to the
  // unified login at `/`.
  useEffect(() => {
    if (stage !== 'checking') return;
    let cancelled = false;
    me()
      .then((user) => {
        if (cancelled) return;
        if (PORTAL_ROLES.admin.includes(user.role)) setStage('in');
        else {
          clearAuth();
          setStage('out');
        }
      })
      .catch(() => {
        if (cancelled) return;
        clearAuth();
        setStage('out');
      });
    return () => {
      cancelled = true;
    };
  }, [stage]);

  // A 401 anywhere bounces back to the unified login.
  useEffect(() => {
    const onExpired = () => setStage('out');
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
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
  const [dateRange, setDateRange] = useState<DateRange>('30D');

  const route = location.pathname.split('/').filter(Boolean)[1] ?? 'dashboard';

  const ctx: SAContext = { dateRange, setDateRange };

  return (
    <div className={styles.page}>
      <Sidebar route={route} onSignOut={onSignOut} />
      <div className={styles.frame}>
        <Topbar route={route} dateRange={dateRange} onDateRange={setDateRange} />
        <main className={styles.scroll}>
          <div className={styles.inner}>
            <Routes>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route element={<Outlet context={ctx} />}>
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="products" element={<Products />} />
                <Route path="productEdit" element={<ProductEdit />} />
                <Route path="productDetail/:id" element={<ProductDetail />} />
                <Route path="categories" element={<Categories />} />
                <Route path="pincodes" element={<Pincodes />} />
                <Route path="partners" element={<Partners />} />
                <Route path="partnerDetail/:id" element={<PartnerDetail />} />
                <Route path="orders" element={<Orders />} />
                <Route path="orderDetail/:id" element={<OrderDetail />} />
                <Route path="orderDetail" element={<OrderDetail />} />
                <Route path="users" element={<UsersScreen />} />
                <Route path="reseller-pricing" element={<ResellerPricing />} />
                <Route path="reviews" element={<Reviews />} />
                <Route path="qr-campaigns" element={<QrCampaigns />} />
                <Route path="banners" element={<Banners />} />
                <Route path="payments" element={<Payments />} />
                <Route path="reports" element={<Reports />} />
                <Route path="bulk" element={<Bulk />} />
                <Route path="*" element={<Navigate to="dashboard" replace />} />
              </Route>
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}
