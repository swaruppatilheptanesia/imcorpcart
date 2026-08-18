import { Router } from 'express';
import * as ctrl from '../controllers/company.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { idParam } from '../validators/common.schema';
import {
  companyEmployeeListQuery,
  createEmployeeBody,
  updateEmployeeBody,
} from '../validators/company.schema';

const router = Router();

router.get('/profile', asyncHandler(ctrl.profile));
router.get('/dashboard', asyncHandler(ctrl.dashboard));
router.get('/orders', asyncHandler(ctrl.listOrders));
router.get('/employees', validate({ query: companyEmployeeListQuery }), asyncHandler(ctrl.listEmployees));
router.post('/employees', validate({ body: createEmployeeBody }), asyncHandler(ctrl.createEmployee));
router.patch(
  '/employees/:id',
  validate({ params: idParam, body: updateEmployeeBody }),
  asyncHandler(ctrl.updateEmployee),
);

export default router;
