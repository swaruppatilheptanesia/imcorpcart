import { Router } from 'express';
import * as ctrl from '../controllers/coupon.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { idParam } from '../validators/common.schema';
import { couponListQuery, createCouponBody, updateCouponBody } from '../validators/coupon.schema';

const router = Router();

router.get('/', validate({ query: couponListQuery }), asyncHandler(ctrl.list));
router.get('/stats', asyncHandler(ctrl.stats));
router.post('/', validate({ body: createCouponBody }), asyncHandler(ctrl.create));
router.get('/:id', validate({ params: idParam }), asyncHandler(ctrl.get));
router.put('/:id', validate({ params: idParam, body: updateCouponBody }), asyncHandler(ctrl.update));

export default router;
