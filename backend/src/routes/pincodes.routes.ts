import { Router } from 'express';
import * as ctrl from '../controllers/pincode.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { idParam } from '../validators/common.schema';
import {
  pincodeListQuery,
  createPincodeBody,
  updatePincodeBody,
  importPincodesBody,
  updateSettingBody,
} from '../validators/pincode.schema';

const router = Router();

// Global courier/mode kill-switches (declared before /:id so they aren't shadowed).
router.get('/settings', asyncHandler(ctrl.settings));
router.patch('/settings', validate({ body: updateSettingBody }), asyncHandler(ctrl.updateSetting));

router.get('/export', validate({ query: pincodeListQuery }), asyncHandler(ctrl.exportAll));
router.post('/import', validate({ body: importPincodesBody }), asyncHandler(ctrl.importRows));

router.get('/', validate({ query: pincodeListQuery }), asyncHandler(ctrl.list));
router.post('/', validate({ body: createPincodeBody }), asyncHandler(ctrl.create));
router.patch('/:id', validate({ params: idParam, body: updatePincodeBody }), asyncHandler(ctrl.update));
router.delete('/:id', validate({ params: idParam }), asyncHandler(ctrl.remove));

export default router;
