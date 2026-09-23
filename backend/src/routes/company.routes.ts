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
import {
  seppRequestListQuery,
  seppDecisionBody,
  installmentParams,
  companyAddressBody,
  updateCompanyAddressBody,
} from '../validators/sepp.schema';

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

// Smart EPP — HR stage-1 approval queue.
router.get('/sepp/requests', validate({ query: seppRequestListQuery }), asyncHandler(ctrl.listSeppRequests));
router.get('/sepp/requests/:id', validate({ params: idParam }), asyncHandler(ctrl.getSeppRequest));
router.post(
  '/sepp/requests/:id/decision',
  validate({ params: idParam, body: seppDecisionBody }),
  asyncHandler(ctrl.decideSeppRequest),
);
router.post(
  '/sepp/requests/:id/installments/:no/paid',
  validate({ params: installmentParams }),
  asyncHandler(ctrl.markInstallmentPaid),
);

// Office branches — the only delivery points for Smart-EPP orders.
router.get('/addresses', asyncHandler(ctrl.listAddresses));
router.post('/addresses', validate({ body: companyAddressBody }), asyncHandler(ctrl.createAddress));
router.patch('/addresses/:id', validate({ params: idParam, body: updateCompanyAddressBody }), asyncHandler(ctrl.updateAddress));
router.delete('/addresses/:id', validate({ params: idParam }), asyncHandler(ctrl.deleteAddress));

export default router;
