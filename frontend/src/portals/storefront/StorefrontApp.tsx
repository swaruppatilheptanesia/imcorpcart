import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ToastProvider, Spinner } from '@/components';
import { me, logout as apiLogout, shopStore } from '@/data/shop-api';
import { PORTAL_ROLES } from '@/data/unified-auth';
import { StoreProvider } from './store-context';
import type { ShopShellCtx } from './shop-context';
import { TopNav } from './shell/TopNav';
import { SecondaryNav } from './shell/SecondaryNav';
import { Footer } from './shell/Footer';
import { MobileHeader } from './shell/MobileHeader';
import { TabBar } from './shell/TabBar';
import { FilterPanel } from './overlays/FilterPanel';
import { TAB_HIDDEN } from './nav';
import { Home } from './screens/Home';
import { Search } from './screens/Search';
import { Product } from './screens/Product';
import { Cart } from './screens/Cart';
import { Checkout } from './screens/Checkout';
import { Processing } from './screens/Processing';
import { Result } from './screens/Result';
import { Orders } from './screens/Orders';
import { OrderDetail } from './screens/OrderDetail';
import { Tracking } from './screens/Tracking';
import { Wishlist } from './screens/Wishlist';
import { Notifs } from './screens/Notifs';
import { Profile } from './screens/Profile';
import { About } from './screens/About';
import { Contact } from './screens/Contact';
import styles from './StorefrontApp.module.css';

type Stage = 'checking' | 'public' | 'in';

export default function StorefrontApp() {
  const navigate = useNavigate();
  // 'checking' validates a stored token; 'in' = signed-in employee (EPP prices);
  // 'public' = anonymous browsing (MOP prices, cart/checkout prompt login).
  const [stage, setStage] = useState<Stage>(() => (shopStore.getToken() ? 'checking' : 'public'));

  // RBAC: only an employee (shopper) session opens the authed storefront;
  // anything else falls back to public browsing.
  useEffect(() => {
    if (stage !== 'checking') return;
    let cancelled = false;
    me()
      .then((user) => {
        if (cancelled) return;
        if (PORTAL_ROLES.shopper.includes(user.role)) setStage('in');
        else {
          shopStore.clearAuth();
          setStage('public');
        }
      })
      .catch(() => {
        if (cancelled) return;
        shopStore.clearAuth();
        setStage('public');
      });
    return () => {
      cancelled = true;
    };
  }, [stage]);

  useEffect(() => {
    const onExpired = () => setStage('public');
    window.addEventListener(shopStore.expiredEvent, onExpired);
    return () => window.removeEventListener(shopStore.expiredEvent, onExpired);
  }, []);

  if (stage === 'checking') {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <Spinner size={28} />
      </div>
    );
  }

  const authed = stage === 'in';
  return (
    <ToastProvider>
      <StoreProvider authed={authed}>
        <ShopShell
          authed={authed}
          onSignOut={() => {
            void apiLogout();
            navigate('/');
          }}
        />
      </StoreProvider>
    </ToastProvider>
  );
}

function ShopShell({ authed, onSignOut }: { authed: boolean; onSignOut: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [filterOpen, setFilterOpen] = useState(false);

  const route = location.pathname.split('/').filter(Boolean)[1] ?? 'home';
  const showTab = !TAB_HIDDEN.has(route);

  // Close the filter panel on navigation.
  useEffect(() => setFilterOpen(false), [route]);

  const ctx: ShopShellCtx = { openFilter: () => setFilterOpen(true) };

  // Routes that require a signed-in employee; in public mode send them to login.
  const authOnly = (el: ReactNode) => (authed ? el : <Navigate to="/" replace />);

  return (
    <div className={styles.page}>
      <TopNav authed={authed} onSignOut={onSignOut} onSignIn={() => navigate('/')} />
      <SecondaryNav />
      <MobileHeader route={route} />
      <main className={styles.main}>
        <Routes>
          <Route index element={<Navigate to="home" replace />} />
          <Route element={<Outlet context={ctx} />}>
            <Route path="home" element={<Home />} />
            <Route path="search" element={<Search />} />
            <Route path="product/:id" element={<Product />} />
            <Route path="cart" element={authOnly(<Cart />)} />
            <Route path="checkout" element={authOnly(<Checkout />)} />
            <Route path="processing" element={authOnly(<Processing />)} />
            <Route path="success" element={authOnly(<Result kind="success" />)} />
            <Route path="failed" element={authOnly(<Result kind="failed" />)} />
            <Route path="orders" element={authOnly(<Orders />)} />
            <Route path="orderDetail/:id" element={authOnly(<OrderDetail />)} />
            <Route path="tracking/:id" element={authOnly(<Tracking />)} />
            <Route path="wishlist" element={authOnly(<Wishlist />)} />
            <Route path="notifs" element={authOnly(<Notifs />)} />
            <Route path="about" element={<About />} />
            <Route path="contact" element={<Contact />} />
            <Route path="profile" element={authOnly(<Profile onSignOut={onSignOut} />)} />
            <Route path="*" element={<Navigate to="home" replace />} />
          </Route>
        </Routes>
      </main>
      <Footer />
      {showTab && <TabBar route={route} />}
      <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} />
    </div>
  );
}
