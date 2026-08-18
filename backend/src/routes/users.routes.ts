import { Router } from 'express';
import * as ctrl from '../controllers/user.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { idParam } from '../validators/common.schema';
import {
  userListQuery,
  inviteUserBody,
  updateUserBody,
  importUsersBody,
  createCompanyBody,
  updateCompanyBody,
  assignAdminBody,
  companyIdParam,
  updateResellerBody,
} from '../validators/user.schema';

const router = Router();

router.get('/', validate({ query: userListQuery }), asyncHandler(ctrl.list));
router.post('/', validate({ body: inviteUserBody }), asyncHandler(ctrl.invite));
router.post('/companies', validate({ body: createCompanyBody }), asyncHandler(ctrl.createCompany));
router.post(
  '/companies/:companyId/assign-admin',
  validate({ params: companyIdParam, body: assignAdminBody }),
  asyncHandler(ctrl.assignAdmin),
);
router.post('/import', validate({ body: importUsersBody }), asyncHandler(ctrl.importUsers));
router.patch('/resellers/:id', validate({ params: idParam, body: updateResellerBody }), asyncHandler(ctrl.updateReseller));
router.patch('/companies/:id', validate({ params: idParam, body: updateCompanyBody }), asyncHandler(ctrl.updateCompany));
router.patch('/:id', validate({ params: idParam, body: updateUserBody }), asyncHandler(ctrl.update));

export default router;
