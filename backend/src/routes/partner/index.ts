import { Router, type Request, type Response, type NextFunction } from 'express';
import swaggerUi from 'swagger-ui-express';
import * as ctrl from '../../controllers/partner-api.controller';
import { requirePartner } from '../../middleware/partnerAuth';
import { partnerLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { partnerOpenApiSpec } from '../../docs/partner-openapi';
import { swaggerCustomCss, swaggerFavicon } from '../../docs/swagger-theme';
import { partnerCatalogueQuery, deliveryQuery, acceptOrderBody, cancelOrderBody } from '../../validators/partner.schema';

// Machine-to-machine partner API, mounted at /partner-api/v1. Every route is
// bearer-token + IP authenticated and rate-limited per partner.
const router = Router();

// Public API docs (no auth) — raw spec + Swagger UI. Swagger UI's assets trip the
// global helmet CSP, so drop that header just for the docs subtree.
const spec = partnerOpenApiSpec as unknown as Record<string, unknown>;
router.get('/openapi.json', (_req, res) => res.json(partnerOpenApiSpec));
router.use(
  '/docs',
  (_req: Request, res: Response, next: NextFunction) => {
    res.removeHeader('Content-Security-Policy');
    next();
  },
  swaggerUi.serveFiles(spec),
  // Read-only reference: no Authorize box (no securityScheme in the spec) and
  // supportedSubmitMethods:[] disables "Try it out" so no credential is ever
  // entered. Safe to share the public /docs URL with vendors.
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

// Everything below requires partner auth + rate limiting.
router.use(partnerLimiter, asyncHandler(requirePartner));

router.get('/ping', asyncHandler(ctrl.ping));
router.get('/catalogue', validate({ query: partnerCatalogueQuery }), asyncHandler(ctrl.listCatalogue));
router.get('/catalogue/:sku', asyncHandler(ctrl.getCatalogueItem));
router.get('/delivery', validate({ query: deliveryQuery }), asyncHandler(ctrl.delivery));
router.post('/orders', validate({ body: acceptOrderBody }), asyncHandler(ctrl.createOrder));
router.get('/orders/:ref', asyncHandler(ctrl.getOrder));
router.post('/orders/:ref/cancel', validate({ body: cancelOrderBody }), asyncHandler(ctrl.cancelOrder));

export default router;
