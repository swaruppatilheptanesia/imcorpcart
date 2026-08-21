import { Router } from 'express';
import * as ctrl from '../controllers/bulk.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { bulkImportBody, bulkPriceUpdateBody, bulkCashbackUpdateBody } from '../validators/bulk.schema';

const router = Router();

router.post('/import', validate({ body: bulkImportBody }), asyncHandler(ctrl.importProducts));
router.post('/price-update', validate({ body: bulkPriceUpdateBody }), asyncHandler(ctrl.priceUpdate));
router.post('/cashback-update', validate({ body: bulkCashbackUpdateBody }), asyncHandler(ctrl.cashbackUpdate));

export default router;
