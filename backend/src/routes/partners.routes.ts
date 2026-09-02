import { Router } from 'express';
import * as ctrl from '../controllers/partner.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { idParam } from '../validators/common.schema';
import {
  createPartnerBody,
  updatePartnerBody,
  catalogueCandidatesQuery,
  addCatalogueBody,
  updateCatalogueEntryBody,
  partnerOrdersQuery,
} from '../validators/partner.schema';

// Super-Admin partner registry (the "Partners" console). Auth applied by the
// parent group in routes/index.ts.
const router = Router();

router.get('/', asyncHandler(ctrl.list));
router.post('/', validate({ body: createPartnerBody }), asyncHandler(ctrl.create));
router.get('/:id', validate({ params: idParam }), asyncHandler(ctrl.get));
router.patch('/:id', validate({ params: idParam, body: updatePartnerBody }), asyncHandler(ctrl.update));
router.delete('/:id', validate({ params: idParam }), asyncHandler(ctrl.remove));
router.post('/:id/rotate-secret', validate({ params: idParam }), asyncHandler(ctrl.rotateSecret));
router.get('/:id/webhooks', validate({ params: idParam }), asyncHandler(ctrl.webhooks));
router.post('/:id/webhooks/test', validate({ params: idParam }), asyncHandler(ctrl.testWebhook));
router.post('/:id/webhooks/:deliveryId/resend', asyncHandler(ctrl.resendWebhook));
router.get('/:id/activity', validate({ params: idParam }), asyncHandler(ctrl.activity));
router.get('/:id/orders', validate({ params: idParam, query: partnerOrdersQuery }), asyncHandler(ctrl.orders));

// Catalogue management.
router.get('/:id/catalogue', validate({ params: idParam, query: catalogueCandidatesQuery }), asyncHandler(ctrl.catalogue));
router.get('/:id/catalogue/candidates', validate({ params: idParam, query: catalogueCandidatesQuery }), asyncHandler(ctrl.candidates));
router.post('/:id/catalogue', validate({ params: idParam, body: addCatalogueBody }), asyncHandler(ctrl.addCatalogue));
router.patch('/:id/catalogue/:entryId', validate({ body: updateCatalogueEntryBody }), asyncHandler(ctrl.updateCatalogueEntry));
router.delete('/:id/catalogue/:entryId', asyncHandler(ctrl.removeCatalogueEntry));

export default router;
