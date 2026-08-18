import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { env } from '../config/env';

// Attach a request id and log a one-line access record per request.
export function requestContext(req: Request, res: Response, next: NextFunction) {
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);

  if (!env.isProd) {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      // eslint-disable-next-line no-console
      console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${ms}ms)`);
    });
  }

  next();
}
