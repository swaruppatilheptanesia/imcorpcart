import { Router } from 'express';
import * as ctrl from '../controllers/dashboard.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { dashboardQuery } from '../validators/dashboard.schema';

const router = Router();

router.get('/', validate({ query: dashboardQuery }), asyncHandler(ctrl.get));

export default router;
