import { Router } from 'express';
import * as ctrl from '../controllers/vendor-source.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { idParam } from '../validators/common.schema';
import { updateSourceBody, runsQuery } from '../validators/vendor-source.schema';

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
router.get('/:id/runs', validate({ params: idParam, query: runsQuery }), asyncHandler(ctrl.runs));
router.get('/:id/products', validate({ params: idParam, query: runsQuery }), asyncHandler(ctrl.products));

export default router;
