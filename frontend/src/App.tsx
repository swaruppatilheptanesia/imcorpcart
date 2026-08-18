import { Route, Routes } from 'react-router-dom';
import SuperAdminApp from './portals/super-admin/SuperAdminApp';
import CompanyApp from './portals/company/CompanyApp';
import ResellerApp from './portals/reseller/ResellerApp';
import StorefrontApp from './portals/storefront/StorefrontApp';
import { AuthGate } from './auth/AuthGate';

export default function App() {
  return (
    <Routes>
      <Route path="/super-admin/*" element={<SuperAdminApp />} />
      <Route path="/company/*" element={<CompanyApp />} />
      <Route path="/reseller/*" element={<ResellerApp />} />
      <Route path="/shop/*" element={<StorefrontApp />} />
      <Route path="/" element={<AuthGate />} />
      <Route path="*" element={<AuthGate />} />
    </Routes>
  );
}
