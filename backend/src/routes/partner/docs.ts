import { Router, type Request, type Response, type NextFunction } from 'express';
import swaggerUi from 'swagger-ui-express';
import { partnerOpenApiSpec } from '../../docs/partner-openapi';
import { swaggerCustomCss, swaggerFavicon } from '../../docs/swagger-theme';

// Public partner-API reference — the raw OpenAPI spec (`/openapi.json`) + branded
// Swagger UI (`/docs`). No auth: read-only (no Authorize box, "Try it out"
// disabled), so it's safe to share with vendors. Served by the partner router,
// which is mounted under `/api` (canonical: `/api/partner-api/v1/docs`) and at
// the bare `/partner-api/v1` for local use.
const spec = partnerOpenApiSpec as unknown as Record<string, unknown>;

export const partnerDocsRouter = Router();

partnerDocsRouter.get('/openapi.json', (_req, res) => res.json(partnerOpenApiSpec));

// One options object for BOTH calls. `serveFiles` is what actually serves
// `swagger-ui-init.js`, and it is mounted first — so options given only to
// `setup()` never reach the browser (it rendered `customOptions: {}`, which is
// why "Try it out" and Execute showed up on a reference we describe as
// read-only).
const uiOptions = {
  customSiteTitle: 'Imcorpcart Partner API',
  customCss: swaggerCustomCss,
  customfavIcon: swaggerFavicon,
  swaggerOptions: {
    supportedSubmitMethods: [], // read-only — no "Try it out", no Execute
    tryItOutEnabled: false,
    docExpansion: 'list',
    defaultModelsExpandDepth: 1,
    syntaxHighlight: { theme: 'idea' },
  },
};

partnerDocsRouter.use(
  '/docs',
  // Swagger UI's inline assets trip the global helmet CSP — drop it for this subtree.
  (_req: Request, res: Response, next: NextFunction) => {
    res.removeHeader('Content-Security-Policy');
    next();
  },
  swaggerUi.serveFiles(spec, uiOptions),
  swaggerUi.setup(spec, uiOptions),
);

export default partnerDocsRouter;
