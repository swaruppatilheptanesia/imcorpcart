import { Router } from 'express';
import * as ctrl from '../controllers/public.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { idParam } from '../validators/common.schema';

// Public (no-auth) storefront catalog — MOP-priced.
const router = Router();

router.get('/products', asyncHandler(ctrl.listProducts));
router.get('/products/:id', validate({ params: idParam }), asyncHandler(ctrl.getProduct));
router.get('/banners', asyncHandler(ctrl.listBanners));
router.get('/delivery', asyncHandler(ctrl.deliveryEstimate));

export default router;
