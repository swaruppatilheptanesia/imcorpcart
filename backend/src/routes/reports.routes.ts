import { Router } from 'express';
import * as ctrl from '../controllers/report.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { reportLimiter } from '../middleware/rateLimit';
import { reportTypeParams } from '../validators/report.schema';

const router = Router();

// The catalogue drives the whole admin screen: ids, titles, column lists and
// filter controls all come from here, so adding a report needs no frontend change.
router.get('/', asyncHandler(ctrl.list));

// Preview and download run the SAME descriptor and generator; preview just
// stops after the first page. They cannot disagree about a value.
router.get('/:type/preview', validate({ params: reportTypeParams }), asyncHandler(ctrl.preview));
router.get('/:type/download', reportLimiter, validate({ params: reportTypeParams }), asyncHandler(ctrl.download));

export default router;
