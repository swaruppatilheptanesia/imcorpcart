import { Router, type Request, type Response } from 'express';
import { Role } from '@prisma/client';
import { requireAuth, requireRole } from '../middleware/auth';
import authRoutes from './auth.routes';
import publicRoutes from './public.routes';
import productRoutes from './products.routes';
import couponRoutes from './coupons.routes';
import orderRoutes from './orders.routes';
import userRoutes from './users.routes';
import paymentRoutes from './payments.routes';
import reportRoutes from './reports.routes';
import bulkRoutes from './bulk.routes';
import categoryRoutes from './categories.routes';
import pincodeRoutes from './pincodes.routes';
import partnerRoutes from './partners.routes';
import campaignRoutes from './campaigns.routes';
import bannerRoutes from './banners.routes';
import dashboardRoutes from './dashboard.routes';
import uploadRoutes from './uploads.routes';
import companyRoutes from './company.routes';
import resellerRoutes from './reseller.routes';
import shopRoutes from './shop.routes';
import reviewRoutes from './review.routes';

const router = Router();

// Liveness probe (public).
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'imcorpcart-api' });
});

// Public auth endpoints (login, register, verify-otp).
router.use('/auth', authRoutes);

// Public storefront catalog (no auth) — MOP-priced, EPP never exposed.
router.use('/catalog', publicRoutes);

// Role-scoped route groups. Each guard resolves the caller's org in-service, so
// a principal can only ever touch their own data.
const admin = [requireAuth, requireRole(Role.SUPER_ADMIN)];
const company = [requireAuth, requireRole(Role.COMPANY_ADMIN, Role.COMPANY_HR)];
const reseller = [requireAuth, requireRole(Role.RESELLER)];
const shop = [requireAuth, requireRole(Role.EMPLOYEE_EPP, Role.EMPLOYEE_SMART_EPP)];

// Super Admin console.
router.use('/products', ...admin, productRoutes);
router.use('/coupons', ...admin, couponRoutes);
router.use('/orders', ...admin, orderRoutes);
router.use('/users', ...admin, userRoutes);
router.use('/payments', ...admin, paymentRoutes);
router.use('/reports', ...admin, reportRoutes);
router.use('/bulk', ...admin, bulkRoutes);
router.use('/categories', ...admin, categoryRoutes);
router.use('/pincodes', ...admin, pincodeRoutes);
router.use('/partners', ...admin, partnerRoutes);
router.use('/qr-campaigns', ...admin, campaignRoutes);
router.use('/banners', ...admin, bannerRoutes);
router.use('/dashboard', ...admin, dashboardRoutes);
router.use('/uploads', ...admin, uploadRoutes);
router.use('/reviews', ...admin, reviewRoutes);

// Company Admin (HR) portal.
router.use('/company', ...company, companyRoutes);

// Reseller (vendor) portal.
router.use('/reseller', ...reseller, resellerRoutes);

// Storefront (employee) app.
router.use('/shop', ...shop, shopRoutes);

export default router;
