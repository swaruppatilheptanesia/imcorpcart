import { Router } from 'express';
import * as ctrl from '../controllers/shop.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { idParam } from '../validators/common.schema';
import {
  addToCartBody,
  updateCartBody,
  validateCouponBody,
  placeOrderBody,
  createPaymentOrderBody,
  wishlistBody,
  createAddressBody,
  updateAddressBody,
} from '../validators/shop.schema';
import { reviewBody } from '../validators/review.schema';

const router = Router();

// Catalog
router.get('/products', asyncHandler(ctrl.listProducts));
router.get('/products/:id', validate({ params: idParam }), asyncHandler(ctrl.getProduct));
router.post('/products/:id/reviews', validate({ params: idParam, body: reviewBody }), asyncHandler(ctrl.submitReview));
router.get('/coupons', asyncHandler(ctrl.listCoupons));
router.get('/banners', asyncHandler(ctrl.listBanners));

// Cart
router.get('/cart', asyncHandler(ctrl.getCart));
router.post('/cart', validate({ body: addToCartBody }), asyncHandler(ctrl.addToCart));
router.patch('/cart/:id', validate({ params: idParam, body: updateCartBody }), asyncHandler(ctrl.updateCartItem));
router.delete('/cart/:id', validate({ params: idParam }), asyncHandler(ctrl.removeCartItem));

// Coupon + checkout
router.post('/coupon/validate', validate({ body: validateCouponBody }), asyncHandler(ctrl.validateCoupon));
router.post('/payments/order', validate({ body: createPaymentOrderBody }), asyncHandler(ctrl.createPaymentOrder));
router.post('/orders', validate({ body: placeOrderBody }), asyncHandler(ctrl.placeOrder));

// Orders / tracking
router.get('/orders', asyncHandler(ctrl.listOrders));
router.get('/orders/:id', validate({ params: idParam }), asyncHandler(ctrl.getOrder));
router.get('/orders/:id/tracking', validate({ params: idParam }), asyncHandler(ctrl.getTracking));

// Alerts (derived from the shopper's own order history)
router.get('/notifications', asyncHandler(ctrl.listNotifications));

// Wishlist
router.get('/wishlist', asyncHandler(ctrl.getWishlist));
router.post('/wishlist', validate({ body: wishlistBody }), asyncHandler(ctrl.addWishlist));
router.delete('/wishlist/:id', validate({ params: idParam }), asyncHandler(ctrl.removeWishlist));

// Profile
router.get('/profile', asyncHandler(ctrl.profile));

// Addresses (shipping list + one billing)
router.get('/addresses', asyncHandler(ctrl.listAddresses));
router.post('/addresses', validate({ body: createAddressBody }), asyncHandler(ctrl.createAddress));
router.patch('/addresses/:id', validate({ params: idParam, body: updateAddressBody }), asyncHandler(ctrl.updateAddress));
router.delete('/addresses/:id', validate({ params: idParam }), asyncHandler(ctrl.deleteAddress));

export default router;
