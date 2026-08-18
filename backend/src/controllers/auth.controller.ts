import type { Request, Response } from 'express';
import * as authService from '../services/auth.service';
import { getPublicCampaign } from '../services/campaign.service';
import { AppError } from '../utils/AppError';

export async function login(req: Request, res: Response) {
  const { email, password } = req.body;
  const result = await authService.login(email, password, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  res.json(result);
}

export async function register(req: Request, res: Response) {
  const result = await authService.register(req.body);
  res.status(201).json(result);
}

export async function verifyOtp(req: Request, res: Response) {
  const { challengeToken, code } = req.body;
  const result = await authService.verifyLoginOtp(challengeToken, code, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  res.json(result);
}

export async function qrCampaign(req: Request, res: Response) {
  res.json(await getPublicCampaign(String(req.params.token)));
}

export async function logout(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  await authService.logout(req.user.sessionId);
  res.json({ success: true });
}

export async function me(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  const user = await authService.getMe(req.user.id);
  res.json({ user });
}
