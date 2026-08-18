import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { AppError } from '../utils/AppError';

// On-disk location for uploaded images, served statically at /uploads.
export const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
export const UPLOAD_ROUTE = '/uploads';

// Ensure the directory exists at boot (safe if already present).
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `${nanoid()}${EXT[file.mimetype] ?? ''}`),
});

// Single-file image upload, 5MB cap, mime-allowlisted.
export const imageUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(AppError.badRequest('Only PNG, JPG, or WEBP images are allowed'));
      return;
    }
    cb(null, true);
  },
});
