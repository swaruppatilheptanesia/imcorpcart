import { Router } from 'express';
import * as ctrl from '../../controllers/partner-api.controller';
import { requirePartner } from '../../middleware/partnerAuth';
import { partnerLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { partnerDocsRouter } from './docs';
import { partnerCatalogueQuery, deliveryQuery, acceptOrderBody, cancelOrderBody } from '../../validators/partner.schema';

// Machine-to-machine partner API, mounted at /partner-api/v1. Every route is
// bearer-token + IP authenticated and rate-limited per partner.
const router = Router();

// Public API docs (no auth) — raw spec + Swagger UI at /openapi.json + /docs. The
// same router is also mounted under /api (see routes/index.ts) so the docs stay
// reachable through the /api reverse proxy in production.
router.use('/', partnerDocsRouter);

// Everything below requires partner auth + rate limiting.
router.use(partnerLimiter, asyncHandler(requirePartner));

router.get('/ping', asyncHandler(ctrl.ping));
router.get('/catalogue', validate({ query: partnerCatalogueQuery }), asyncHandler(ctrl.listCatalogue));
router.get('/catalogue/:sku', asyncHandler(ctrl.getCatalogueItem));
router.get('/delivery', validate({ query: deliveryQuery }), asyncHandler(ctrl.delivery));
router.post('/orders', validate({ body: acceptOrderBody }), asyncHandler(ctrl.createOrder));
router.get('/orders/:ref', asyncHandler(ctrl.getOrder));
router.post('/orders/:ref/cancel', validate({ body: cancelOrderBody }), asyncHandler(ctrl.cancelOrder));

export default router;
