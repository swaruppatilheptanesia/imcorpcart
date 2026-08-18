import { Router } from 'express';
import * as ctrl from '../controllers/payment.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { updatePaymentConfigBody } from '../validators/payment.schema';

const router = Router();

router.get('/config', asyncHandler(ctrl.getConfig));
router.put('/config', validate({ body: updatePaymentConfigBody }), asyncHandler(ctrl.updateConfig));

export default router;
