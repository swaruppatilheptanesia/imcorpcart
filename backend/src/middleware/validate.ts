import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { AppError } from '../utils/AppError';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

// Validate+coerce parts of the request against zod schemas. On success the
// parsed (typed/coerced) values replace the originals. On failure -> 422.
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
      if (schemas.query) {
        // Express 5's req.query getter is read-only; store the parsed result
        // on a separate property the controllers read from.
        (req as { validatedQuery?: unknown }).validatedQuery = schemas.query.parse(req.query);
      }
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        }));
        return next(AppError.validation('Request validation failed', details));
      }
      next(err);
    }
  };
}

// Helper so controllers can read the coerced query regardless of Express version.
export function getQuery<T = Record<string, unknown>>(req: Request): T {
  return ((req as { validatedQuery?: unknown }).validatedQuery ?? req.query) as T;
}

// Express 5 types params as `string | string[]`; our routes validate them as
// single strings, so this reads one param as a string.
export function getParam(req: Request, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : (v as string);
}
