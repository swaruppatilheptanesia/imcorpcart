import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { AppError } from '../utils/AppError';
import { env } from '../config/env';

// 404 for any unmatched route.
export function notFound(req: Request, _res: Response, next: NextFunction) {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// Centralised error translator. Must be the LAST middleware registered.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details: unknown;

  if (err instanceof AppError) {
    status = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      status = 409;
      code = 'CONFLICT';
      const target = (err.meta?.target as string[] | undefined)?.join(', ');
      message = target ? `A record with that ${target} already exists` : 'Unique constraint violated';
    } else if (err.code === 'P2025') {
      status = 404;
      code = 'NOT_FOUND';
      message = 'Record not found';
    } else if (err.code === 'P2003') {
      status = 400;
      code = 'FK_CONSTRAINT';
      message = 'Related record does not exist';
    } else {
      status = 400;
      code = 'DB_ERROR';
      message = 'Database request failed';
    }
  } else if (err instanceof Prisma.PrismaClientValidationError) {
    status = 400;
    code = 'DB_VALIDATION';
    message = 'Invalid database query';
  } else if (err instanceof MulterError) {
    status = 400;
    code = 'UPLOAD_ERROR';
    message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 5MB)' : err.message;
  } else if (err instanceof Error) {
    message = err.message || message;
  }

  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error('[error]', err);
  }

  res.status(status).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      ...(!env.isProd && status >= 500 && err instanceof Error ? { stack: err.stack } : {}),
    },
  });
}
