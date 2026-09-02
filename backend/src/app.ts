import express, { type Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { API_PREFIX } from './config/constants';
import { UPLOAD_DIR, UPLOAD_ROUTE } from './config/upload';
import { requestContext } from './middleware/requestContext';
import { notFound, errorHandler } from './middleware/error';
import routes from './routes';
import partnerRoutes from './routes/partner';

// Build and configure the Express application (no listening here — see server.ts).
export function createApp(): Application {
  const app = express();

  app.disable('x-powered-by');
  // Behind a reverse proxy (nginx in prod) so req.ip is the real client — used by
  // the partner IP allowlist and rate limiter.
  app.set('trust proxy', 1);
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
  app.use(
    express.json({
      limit: '5mb', // 5mb headroom for bulk-import payloads
      // Stash the raw body so the partner API can HMAC-verify the exact bytes.
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf.toString('utf8');
      },
    }),
  );
  app.use(express.urlencoded({ extended: true }));
  app.use(requestContext);

  // Serve uploaded product images from disk.
  app.use(UPLOAD_ROUTE, express.static(UPLOAD_DIR));

  app.use(API_PREFIX, routes);

  // Machine-to-machine partner integration API (separate front door, its own
  // key/HMAC auth — a sibling to /api, not under it).
  app.use('/partner-api/v1', partnerRoutes);

  // 404 + centralised error handling (must be last).
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
