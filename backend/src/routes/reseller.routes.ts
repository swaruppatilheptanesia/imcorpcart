import { Router } from 'express';
import * as ctrl from '../controllers/reseller.controller';
import * as uploadCtrl from '../controllers/upload.controller';
import { imageUpload } from '../config/upload';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { idParam } from '../validators/common.schema';
import {
  resellerListQuery,
  transitUpdateBody,
  resellerOfferUpdateBody,
  resellerFreeGiftBody,
  resellerFreeGiftUpdateBody,
} from '../validators/reseller.schema';

const router = Router();

router.get('/profile', asyncHandler(ctrl.profile));
router.get('/dashboard', asyncHandler(ctrl.dashboard));

// Marketplace offers — the reseller edits only price + stock; the Super Admin
// authors the product master.
router.get('/offers', validate({ query: resellerListQuery }), asyncHandler(ctrl.listOffers));
router.get('/offers/:id', validate({ params: idParam }), asyncHandler(ctrl.getOffer));
router.patch(
  '/offers/:id',
  validate({ params: idParam, body: resellerOfferUpdateBody }),
  asyncHandler(ctrl.updateOffer),
);

// Image upload (reused multer config + controller, guarded by the RESELLER group).
router.post('/uploads', imageUpload.single('file'), uploadCtrl.uploadImage);

router.get('/coupons', asyncHandler(ctrl.listCoupons));

// Free gifts — reseller-managed complimentary items (per-reseller).
router.get('/free-gifts', asyncHandler(ctrl.listFreeGifts));
router.post('/free-gifts', validate({ body: resellerFreeGiftBody }), asyncHandler(ctrl.createFreeGift));
router.put(
  '/free-gifts/:id',
  validate({ params: idParam, body: resellerFreeGiftUpdateBody }),
  asyncHandler(ctrl.updateFreeGift),
);

router.get('/orders', validate({ query: resellerListQuery }), asyncHandler(ctrl.listOrders));
router.get('/orders/:id', validate({ params: idParam }), asyncHandler(ctrl.getOrder));
router.patch(
  '/orders/:id/transit',
  validate({ params: idParam, body: transitUpdateBody }),
  asyncHandler(ctrl.updateTransit),
);

export default router;
