import crypto from 'crypto';
import bcrypt from 'bcryptjs';

// Generate a 6-digit numeric OTP. Uses crypto for uniform, unpredictable codes.
export function generateOtp(): string {
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, '0');
}

// OTP codes are short-lived secrets — store only their hash.
export function hashOtp(code: string): Promise<string> {
  return bcrypt.hash(code, 8);
}

export function verifyOtp(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}
