import type { Request, Response } from 'express';
import * as service from '../services/shop.service';
import * as reviewService from '../services/review.service';
import { getParam } from '../middleware/validate';
import { AppError } from '../utils/AppError';

function userId(req: Request): string {
  if (!req.user) throw AppError.unauthorized();
  return req.user.id;
}

export async function listProducts(_req: Request, res: Response) {
  res.json(await service.listProducts());
}

export async function getProduct(req: Request, res: Response) {
  res.json(await service.getProduct(getParam(req, 'id')));
}

export async function submitReview(req: Request, res: Response) {
  res.status(201).json(await reviewService.submitReview(userId(req), getParam(req, 'id'), req.body));
}

export async function listCoupons(_req: Request, res: Response) {
  res.json(await service.listCoupons());
}

export async function listBanners(_req: Request, res: Response) {
  res.json(await service.listBanners());
}

export async function getCart(req: Request, res: Response) {
  res.json(await service.getCart(userId(req)));
}

export async function addToCart(req: Request, res: Response) {
  res.status(201).json(await service.addToCart(userId(req), req.body));
}

export async function updateCartItem(req: Request, res: Response) {
  res.json(await service.updateCartItem(userId(req), getParam(req, 'id'), req.body));
}

export async function removeCartItem(req: Request, res: Response) {
  res.json(await service.removeCartItem(userId(req), getParam(req, 'id')));
}

export async function validateCoupon(req: Request, res: Response) {
  res.json(await service.validateCoupon(userId(req), req.body.code));
}

export async function createPaymentOrder(req: Request, res: Response) {
  res.status(201).json(await service.createPaymentOrder(userId(req), req.body));
}

export async function placeOrder(req: Request, res: Response) {
  res.status(201).json(await service.placeOrder(userId(req), req.body));
}

export async function listOrders(req: Request, res: Response) {
  res.json(await service.listOrders(userId(req)));
}

export async function getOrder(req: Request, res: Response) {
  res.json(await service.getOrder(userId(req), getParam(req, 'id')));
}

export async function getTracking(req: Request, res: Response) {
  res.json(await service.getTracking(userId(req), getParam(req, 'id')));
}

export async function getWishlist(req: Request, res: Response) {
  res.json(await service.getWishlist(userId(req)));
}

export async function addWishlist(req: Request, res: Response) {
  res.status(201).json(await service.addWishlist(userId(req), req.body.productId));
}

export async function removeWishlist(req: Request, res: Response) {
  res.json(await service.removeWishlist(userId(req), getParam(req, 'id')));
}

export async function profile(req: Request, res: Response) {
  res.json(await service.getProfile(userId(req)));
}

export async function wallet(req: Request, res: Response) {
  res.json(await service.getWallet(userId(req)));
}

export async function listNotifications(req: Request, res: Response) {
  res.json(await service.listNotifications(userId(req)));
}

export async function listAddresses(req: Request, res: Response) {
  res.json(await service.listAddresses(userId(req)));
}

export async function createAddress(req: Request, res: Response) {
  res.status(201).json(await service.createAddress(userId(req), req.body));
}

export async function updateAddress(req: Request, res: Response) {
  res.json(await service.updateAddress(userId(req), getParam(req, 'id'), req.body));
}

export async function deleteAddress(req: Request, res: Response) {
  res.json(await service.deleteAddress(userId(req), getParam(req, 'id')));
}
