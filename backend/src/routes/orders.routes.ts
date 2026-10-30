import { Router } from 'express';
import * as ctrl from '../controllers/order.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { idParam } from '../validators/common.schema';
import {
  orderListQuery,
  overrideStatusBody,
  cancelOrderBody,
  orderItemParams,
  colourSwapBody,
  epodBody,
  invoiceNumberBody,
} from '../validators/order.schema';
import { documentUpload } from '../config/document-upload';
import { transitUpdateBody } from '../validators/reseller.schema';

const router = Router();

router.get('/', validate({ query: orderListQuery }), asyncHandler(ctrl.list));
router.get('/:id', validate({ params: idParam }), asyncHandler(ctrl.get));
router.patch('/:id/status', validate({ params: idParam, body: overrideStatusBody }), asyncHandler(ctrl.overrideStatus));
router.patch('/:id/transit', validate({ params: idParam, body: transitUpdateBody }), asyncHandler(ctrl.updateTransit));
router.post('/:id/cancel', validate({ params: idParam, body: cancelOrderBody }), asyncHandler(ctrl.cancel));
// The seller's GST invoice number, entered by hand once the invoice is raised.
router.patch('/:id/invoice', validate({ params: idParam, body: invoiceNumberBody }), asyncHandler(ctrl.setInvoiceNumber));
router.post(
  '/:id/items/:itemId/retry-voucher',
  validate({ params: orderItemParams }),
  asyncHandler(ctrl.retryVoucher),
);
router.post(
  '/:id/items/:itemId/resend-voucher',
  validate({ params: orderItemParams }),
  asyncHandler(ctrl.resendVoucher),
);
// Colour substitution: read the shippable colours for a line, then move it.
router.get(
  '/:id/items/:itemId/colour-options',
  validate({ params: orderItemParams }),
  asyncHandler(ctrl.itemColourOptions),
);
router.patch(
  '/:id/items/:itemId/colour',
  validate({ params: orderItemParams, body: colourSwapBody }),
  asyncHandler(ctrl.swapItemColour),
);

// Courier automation. Both are additive to the manual transit form above: when
// the aggregator is off or fails, staff enter the AWB and drive transit by hand.
router.post('/:id/awb', validate({ params: idParam }), asyncHandler(ctrl.generateAwb));
router.post('/:id/tracking/refresh', validate({ params: idParam }), asyncHandler(ctrl.refreshTracking));
// Carrier documents: the proof of delivery for DTDC / BlueDart (also fetched
// automatically by the poller) and the Delhivery B2B LR copy, streamed, not stored.
router.post('/:id/epod/fetch', validate({ params: idParam }), asyncHandler(ctrl.fetchCourierEpod));
router.get('/:id/lr-copy', validate({ params: idParam }), asyncHandler(ctrl.downloadLrCopy));

// Proof of delivery. Upload stores the document AND pushes it to the origin
// partner in one call, so it can never sit uploaded-but-unsent. The file is kept
// outside the statically-served uploads directory and read back only here.
router.post(
  '/:id/epod',
  documentUpload.single('file'),
  validate({ params: idParam, body: epodBody }),
  asyncHandler(ctrl.uploadEpod),
);
router.get('/:id/epod/file', validate({ params: idParam }), asyncHandler(ctrl.downloadEpod));
router.post('/:id/epod/resend', validate({ params: idParam }), asyncHandler(ctrl.resendEpod));

export default router;
