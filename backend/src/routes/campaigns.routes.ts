import { Router } from 'express';
import * as ctrl from '../controllers/campaign.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { idParam } from '../validators/common.schema';
import { createCampaignBody, updateCampaignBody } from '../validators/campaign.schema';

const router = Router();

router.get('/', asyncHandler(ctrl.list));
router.post('/', validate({ body: createCampaignBody }), asyncHandler(ctrl.create));
router.patch('/:id', validate({ params: idParam, body: updateCampaignBody }), asyncHandler(ctrl.update));

export default router;
