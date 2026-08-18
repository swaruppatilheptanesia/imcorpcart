import type { Request, Response } from 'express';
import { UPLOAD_ROUTE } from '../config/upload';
import { AppError } from '../utils/AppError';

// Returns the public URL of the just-stored file. multer put the file on disk
// and populated req.file before this runs.
export function uploadImage(req: Request, res: Response) {
  if (!req.file) throw AppError.badRequest('No file provided (expected field "file")');
  res.status(201).json({
    url: `${UPLOAD_ROUTE}/${req.file.filename}`,
    filename: req.file.filename,
    size: req.file.size,
    mimeType: req.file.mimetype,
  });
}
