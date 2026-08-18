import express, { type Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { API_PREFIX } from './config/constants';
import { UPLOAD_DIR, UPLOAD_ROUTE } from './config/upload';
import { requestContext } from './middleware/requestContext';
import { notFound, errorHandler } from './middleware/error';
import routes from './routes';

// Build and configure the Express application (no listening here — see server.ts).
export function createApp(): Application {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    helmet({
      // Allow the SPA (different dev origin) to load uploaded images.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(
    cors({
      origin: env.corsOrigins.includes('*') ? true : env.corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '5mb' })); // 5mb headroom for bulk-import payloads
  app.use(express.urlencoded({ extended: true }));
  app.use(requestContext);

  // Serve uploaded product images from disk.
  app.use(UPLOAD_ROUTE, express.static(UPLOAD_DIR));

  app.use(API_PREFIX, routes);

  // 404 + centralised error handling (must be last).
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
