import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { AppError } from '../utils/AppError';

// Private on-disk store for order documents (proof of delivery, and later
// invoices / e-way bills).
//
// Deliberately NOT under `uploads/`: app.ts serves that directory with
// express.static, mounted before the API router and outside all auth, so
// anything in it is world-readable by URL. A proof of delivery carries the
// recipient's name and signature, so it is served only through an authenticated
// route that checks the caller first.
export const PRIVATE_UPLOAD_DIR = path.resolve(process.cwd(), 'private-uploads');

fs.mkdirSync(PRIVATE_UPLOAD_DIR, { recursive: true });

// 2MB rather than the 5MB image cap: an ePOD is pushed to the partner as base64
// in a webhook body, which inflates it by about a third, and some partner
// gateways reject large POSTs. A scan or phone photo fits comfortably.
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

// PDF matters here — most couriers hand back a scanned PDF, which the existing
// image-only upload rejects.
const ALLOWED_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

// Must stay in step with ALLOWED_MIME: config/upload.ts does `EXT[mime] ?? ''`,
// so a mime allowed without an extension here would write an extension-less
// file that nothing can open.
const EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PRIVATE_UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `${nanoid()}${EXT[file.mimetype] ?? ''}`),
});

export const documentUpload = multer({
  storage,
  limits: { fileSize: MAX_DOCUMENT_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(AppError.badRequest('Only PDF, PNG, JPG or WEBP documents are allowed'));
      return;
    }
    cb(null, true);
  },
});
