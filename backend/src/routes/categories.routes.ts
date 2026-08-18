import { Router } from 'express';
import * as ctrl from '../controllers/category.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { idParam } from '../validators/common.schema';
import { createCategoryBody, updateCategoryBody } from '../validators/category.schema';

const router = Router();

router.get('/', asyncHandler(ctrl.list));
router.post('/', validate({ body: createCategoryBody }), asyncHandler(ctrl.create));
router.patch('/:id', validate({ params: idParam, body: updateCategoryBody }), asyncHandler(ctrl.update));
router.delete('/:id', validate({ params: idParam }), asyncHandler(ctrl.remove));

export default router;
