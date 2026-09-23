import { Router } from 'express';
import * as ctrl from '../controllers/leasing.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { idParam } from '../validators/common.schema';
import {
  leasingParamsBody,
  leasingPreviewBody,
  leasingRequestListQuery,
  leasingDecisionBody,
} from '../validators/leasing.schema';

const router = Router();

router.get('/profile', asyncHandler(ctrl.profile));

// Lease parameters (PTPM, tenure, buy-back, PV discounts, advance fee).
router.get('/params', asyncHandler(ctrl.getParams));
router.patch('/params', validate({ body: leasingParamsBody }), asyncHandler(ctrl.updateParams));
router.post('/params/preview', validate({ body: leasingPreviewBody }), asyncHandler(ctrl.previewParams));

// Companies attached to this leasing company (Super-Admin managed).
router.get('/companies', asyncHandler(ctrl.listCompanies));

// Smart EPP — stage-2 approval queue (requests HR has already approved).
router.get('/requests', validate({ query: leasingRequestListQuery }), asyncHandler(ctrl.listRequests));
router.get('/requests/:id', validate({ params: idParam }), asyncHandler(ctrl.getRequest));
router.post(
  '/requests/:id/decision',
  validate({ params: idParam, body: leasingDecisionBody }),
  asyncHandler(ctrl.decideRequest),
);

export default router;
