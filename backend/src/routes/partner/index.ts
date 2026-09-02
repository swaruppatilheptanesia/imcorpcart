import { Router } from 'express';
import * as ctrl from '../../controllers/partner-api.controller';
import { requirePartner } from '../../middleware/partnerAuth';
import { partnerLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { partnerCatalogueQuery, acceptOrderBody } from '../../validators/partner.schema';

// Machine-to-machine partner API, mounted at /partner-api/v1. Every route is
// key + bearer secret + IP authenticated and rate-limited per partner.
const router = Router();

router.use(partnerLimiter, asyncHandler(requirePartner));

router.get('/ping', asyncHandler(ctrl.ping));
router.get('/catalogue', validate({ query: partnerCatalogueQuery }), asyncHandler(ctrl.listCatalogue));
router.get('/catalogue/:sku', asyncHandler(ctrl.getCatalogueItem));
router.get('/delivery', asyncHandler(ctrl.delivery));
router.post('/orders', validate({ body: acceptOrderBody }), asyncHandler(ctrl.createOrder));
router.get('/orders/:ref', asyncHandler(ctrl.getOrder));

export default router;
