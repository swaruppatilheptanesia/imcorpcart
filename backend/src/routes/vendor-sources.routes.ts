import { Router } from 'express';
import * as ctrl from '../controllers/vendor-source.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { idParam } from '../validators/common.schema';
import { updateSourceBody, runsQuery, runParams, productDiscountsBody } from '../validators/vendor-source.schema';

// Super-Admin inbound vendor-source registry ("Vendor Sources" console): pull
// external vendors' catalogs into ours. Sources are auto-provisioned per
// dev-registered adapter (no create/delete) — admin configures + syncs only.
// Auth applied by the parent group in routes/index.ts.
const router = Router();

router.get('/adapters', asyncHandler(ctrl.adapters)); // dropdown options (before /:id)
router.get('/', asyncHandler(ctrl.list));
router.get('/:id', validate({ params: idParam }), asyncHandler(ctrl.get));
router.patch('/:id', validate({ params: idParam, body: updateSourceBody }), asyncHandler(ctrl.update));
router.post('/:id/sync', validate({ params: idParam }), asyncHandler(ctrl.sync));
router.post('/:id/reprice', validate({ params: idParam }), asyncHandler(ctrl.reprice));
router.get('/:id/runs/:runId', validate({ params: runParams }), asyncHandler(ctrl.run));
router.get('/:id/runs', validate({ params: idParam, query: runsQuery }), asyncHandler(ctrl.runs));
router.get('/:id/products', validate({ params: idParam, query: runsQuery }), asyncHandler(ctrl.products));
router.post(
  '/:id/product-discounts',
  validate({ params: idParam, body: productDiscountsBody }),
  asyncHandler(ctrl.setProductDiscounts),
);
router.get('/:id/wallet', validate({ params: idParam }), asyncHandler(ctrl.wallet));

export default router;
