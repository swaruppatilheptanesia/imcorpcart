import { Router } from 'express';
import * as ctrl from '../controllers/banner.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { idParam } from '../validators/common.schema';
import { createBannerBody, updateBannerBody } from '../validators/banner.schema';

const router = Router();

router.get('/', asyncHandler(ctrl.list));
router.post('/', validate({ body: createBannerBody }), asyncHandler(ctrl.create));
router.patch('/:id', validate({ params: idParam, body: updateBannerBody }), asyncHandler(ctrl.update));
router.delete('/:id', validate({ params: idParam }), asyncHandler(ctrl.remove));

export default router;
