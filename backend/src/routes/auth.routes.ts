import { Router } from 'express';
import * as ctrl from '../controllers/auth.controller';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimit';
import { asyncHandler } from '../utils/asyncHandler';
import { loginBody, verifyOtpBody, registerBody } from '../validators/auth.schema';

const router = Router();

router.post('/login', authLimiter, validate({ body: loginBody }), asyncHandler(ctrl.login));
router.post('/register', authLimiter, validate({ body: registerBody }), asyncHandler(ctrl.register));
router.post('/verify-otp', authLimiter, validate({ body: verifyOtpBody }), asyncHandler(ctrl.verifyOtp));
// Public: what the registration page shows for a scanned campaign QR.
router.get('/qr-campaign/:token', asyncHandler(ctrl.qrCampaign));
router.post('/logout', requireAuth, asyncHandler(ctrl.logout));
router.get('/me', requireAuth, asyncHandler(ctrl.me));

export default router;
