import { Router, type Request, type Response, type NextFunction } from 'express';
import swaggerUi from 'swagger-ui-express';
import { partnerOpenApiSpec } from '../../docs/partner-openapi';
import { swaggerCustomCss, swaggerFavicon } from '../../docs/swagger-theme';

// Public partner-API reference — the raw OpenAPI spec (`/openapi.json`) + branded
// Swagger UI (`/docs`). No auth: read-only (no Authorize box, "Try it out"
// disabled), so it's safe to share with vendors. Extracted into its own router so
// it can be mounted BOTH at `/partner-api/v1` (the canonical path) AND under the
// `/api` prefix (`/api/partner-api/v1/docs`) — the latter rides the reverse proxy
// that already forwards `/api` to the backend, so the docs open in production even
// when `/partner-api` itself isn't proxied.
const spec = partnerOpenApiSpec as unknown as Record<string, unknown>;

export const partnerDocsRouter = Router();

partnerDocsRouter.get('/openapi.json', (_req, res) => res.json(partnerOpenApiSpec));

partnerDocsRouter.use(
  '/docs',
  // Swagger UI's inline assets trip the global helmet CSP — drop it for this subtree.
  (_req: Request, res: Response, next: NextFunction) => {
    res.removeHeader('Content-Security-Policy');
    next();
  },
  swaggerUi.serveFiles(spec),
  swaggerUi.setup(spec, {
    customSiteTitle: 'Imcorpcart Partner API',
    customCss: swaggerCustomCss,
    customfavIcon: swaggerFavicon,
    swaggerOptions: {
      supportedSubmitMethods: [], // read-only — no "Try it out"
      tryItOutEnabled: false,
      docExpansion: 'list',
      defaultModelsExpandDepth: 1,
      syntaxHighlight: { theme: 'idea' },
    },
  }),
);

export default partnerDocsRouter;
