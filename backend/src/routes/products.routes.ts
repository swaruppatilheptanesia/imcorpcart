import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../controllers/product.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { idParam } from '../validators/common.schema';
import {
  productListQuery,
  createProductBody,
  updateProductBody,
  bulkProductBody,
  attachOfferBody,
  updateOfferBody,
} from '../validators/product.schema';

const router = Router();

// Variant-family keys in use (for the product form's family datalist).
router.get('/families', asyncHandler(ctrl.families));

// Reseller directory + a reseller's gifts (for the offer form dropdowns).
router.get('/resellers', asyncHandler(ctrl.listResellers));
router.get(
  '/resellers/:resellerId/gifts',
  validate({ params: z.object({ resellerId: z.string().min(1) }) }),
  asyncHandler(ctrl.resellerGifts),
);

router.get('/', validate({ query: productListQuery }), asyncHandler(ctrl.list));
router.post('/', validate({ body: createProductBody }), asyncHandler(ctrl.create));
router.patch('/bulk', validate({ body: bulkProductBody }), asyncHandler(ctrl.bulk));
router.get('/:id', validate({ params: idParam }), asyncHandler(ctrl.get));
router.put('/:id', validate({ params: idParam, body: updateProductBody }), asyncHandler(ctrl.update));
router.delete('/:id', validate({ params: idParam }), asyncHandler(ctrl.remove));

// Per-product marketplace offers (attach sellers, edit their price/stock).
const offerParams = z.object({ id: z.string().min(1), offerId: z.string().min(1) });
router.get('/:id/offers', validate({ params: idParam }), asyncHandler(ctrl.listOffers));
router.post('/:id/offers', validate({ params: idParam, body: attachOfferBody }), asyncHandler(ctrl.attachOffer));
router.patch(
  '/:id/offers/:offerId',
  validate({ params: offerParams, body: updateOfferBody }),
  asyncHandler(ctrl.updateOffer),
);
router.delete('/:id/offers/:offerId', validate({ params: offerParams }), asyncHandler(ctrl.removeOffer));

export default router;
