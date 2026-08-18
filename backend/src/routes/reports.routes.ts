import { Router } from 'express';
import * as ctrl from '../controllers/report.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { exportReportParams, exportReportQuery, exportReportBody } from '../validators/report.schema';

const router = Router();

router.get('/', ctrl.list);
router.post(
  '/:type/export',
  validate({ params: exportReportParams, query: exportReportQuery, body: exportReportBody }),
  asyncHandler(ctrl.exportReport),
);

export default router;
