import { Router } from 'express';
import * as ctrl from '../controllers/review.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { idParam } from '../validators/common.schema';
import { reviewListQuery, reviewStatusBody } from '../validators/review.schema';

const router = Router();

// Super-Admin review moderation.
router.get('/', validate({ query: reviewListQuery }), asyncHandler(ctrl.list));
router.patch('/:id/status', validate({ params: idParam, body: reviewStatusBody }), asyncHandler(ctrl.setStatus));

export default router;
