import { Router } from 'express';
import * as ctrl from '../controllers/order.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { idParam } from '../validators/common.schema';
import { orderListQuery, overrideStatusBody, cancelOrderBody } from '../validators/order.schema';
import { transitUpdateBody } from '../validators/reseller.schema';

const router = Router();

router.get('/', validate({ query: orderListQuery }), asyncHandler(ctrl.list));
router.get('/:id', validate({ params: idParam }), asyncHandler(ctrl.get));
router.patch('/:id/status', validate({ params: idParam, body: overrideStatusBody }), asyncHandler(ctrl.overrideStatus));
router.patch('/:id/transit', validate({ params: idParam, body: transitUpdateBody }), asyncHandler(ctrl.updateTransit));
router.post('/:id/cancel', validate({ params: idParam, body: cancelOrderBody }), asyncHandler(ctrl.cancel));

export default router;
