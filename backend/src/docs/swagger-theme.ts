// Branded Swagger UI theme for the partner API docs (/partner-api/v1/docs).
// Passed to swaggerUi.setup() as customCss/customfavIcon. Colors + fonts come
// verbatim from the platform design tokens (frontend/src/styles/tokens.css):
// accent #0a5bd6, Apple-like system font stack, light/dark neutrals. The docs
// are read-only + vendor-shareable, so this is a first-impression surface.

const FONT = `-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif`;
const MONO = `ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace`;

// The Imcorpcart circular brand mark (frontend/src/assets/Logo_IlaMarketing.png),
// embedded as a base64 data URI so the backend-served docs stay self-contained.
const LOGO_PNG_B64 = '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';
const LOGO_URI = `data:image/png;base64,${LOGO_PNG_B64}`;

// Browser-tab favicon = the brand logo.
export const swaggerFavicon = LOGO_URI;

export const swaggerCustomCss = `
/* ---- imcorpcart brand theme for Swagger UI ---- */

.swagger-ui, .swagger-ui .info .title, .swagger-ui .opblock-tag,
.swagger-ui .opblock .opblock-summary-path, .swagger-ui .parameter__name,
.swagger-ui table thead tr th, .swagger-ui .response-col_status,
.swagger-ui .btn, .swagger-ui select, .swagger-ui input {
  font-family: ${FONT};
}
.swagger-ui .microlight, .swagger-ui code, .swagger-ui .prop-format,
.swagger-ui .model, .swagger-ui .parameter__type {
  font-family: ${MONO};
}

/* Kill the default green topbar + URL bar */
.swagger-ui .topbar { display: none; }

/* Page ground + width */
body { background: #f4f5f8; }
.swagger-ui { background: transparent; }
.swagger-ui .wrapper { max-width: 1120px; }

/* Branded header lockup above the title — logo + wordmark */
.swagger-ui .info { margin: 34px 0 26px; }
.swagger-ui .info::before {
  content: 'Imcorpcart';
  display: inline-flex; align-items: center;
  font-weight: 700; font-size: 17px; letter-spacing: .2px;
  color: #14161a; margin-bottom: 16px; min-height: 28px;
  padding: 2px 0 2px 38px;
  background: url('${LOGO_URI}') no-repeat left center;
  background-size: 28px 28px;
}
.swagger-ui .info .title {
  color: #14161a; font-weight: 700; font-size: 30px;
}
.swagger-ui .info .title small { background: #0a5bd6; }
.swagger-ui .info .title small.version-stamp { background: #5b6270; }
.swagger-ui .info a, .swagger-ui a { color: #0a5bd6; }
.swagger-ui .info .description,
.swagger-ui .info .description p,
.swagger-ui .info li { color: #5b6270; }
.swagger-ui .info .description code {
  background: #eef0f4; color: #14161a; padding: 1px 6px; border-radius: 5px;
}

/* Section (tag) headings */
.swagger-ui .opblock-tag {
  color: #14161a; font-size: 17px; font-weight: 650;
  border-bottom: 1px solid #e7e9ee;
}
.swagger-ui .opblock-tag small { color: #949ba7; font-weight: 400; }

/* Operation blocks — clean cards */
.swagger-ui .opblock {
  border: 1px solid #e7e9ee; border-radius: 12px;
  box-shadow: 0 1px 2px rgba(16,18,22,.04);
  margin: 0 0 12px; background: #ffffff;
}
.swagger-ui .opblock .opblock-summary { border-color: #eef0f4; padding: 6px 10px; }
.swagger-ui .opblock .opblock-summary-path,
.swagger-ui .opblock .opblock-summary-path__deprecated { color: #14161a; font-weight: 550; }
.swagger-ui .opblock .opblock-summary-description { color: #5b6270; }

/* Method badges — semantic hues from tokens */
.swagger-ui .opblock .opblock-summary-method {
  border-radius: 8px; font-weight: 650; min-width: 74px; text-shadow: none;
}
.swagger-ui .opblock.opblock-get { background: rgba(43,123,228,.04); border-color: rgba(43,123,228,.35); }
.swagger-ui .opblock.opblock-get .opblock-summary-method { background: #2b7be4; }
.swagger-ui .opblock.opblock-get .opblock-summary { border-color: rgba(43,123,228,.2); }
.swagger-ui .opblock.opblock-post { background: rgba(30,158,106,.04); border-color: rgba(30,158,106,.35); }
.swagger-ui .opblock.opblock-post .opblock-summary-method { background: #1e9e6a; }
.swagger-ui .opblock.opblock-post .opblock-summary { border-color: rgba(30,158,106,.2); }
.swagger-ui .opblock.opblock-put { background: rgba(224,146,26,.04); border-color: rgba(224,146,26,.35); }
.swagger-ui .opblock.opblock-put .opblock-summary-method { background: #e0921a; }
.swagger-ui .opblock.opblock-delete { background: rgba(224,69,59,.04); border-color: rgba(224,69,59,.35); }
.swagger-ui .opblock.opblock-delete .opblock-summary-method { background: #e0453b; }

/* Bodies, params, responses */
.swagger-ui .opblock-body, .swagger-ui .opblock-description-wrapper { color: #14161a; }
.swagger-ui .opblock-section-header { background: #fafbfc; box-shadow: none; border-radius: 8px; }
.swagger-ui .opblock-section-header h4, .swagger-ui .tab li { color: #14161a; }
.swagger-ui table thead tr th, .swagger-ui table thead tr td {
  color: #5b6270; border-bottom: 1px solid #e7e9ee;
}
.swagger-ui .parameter__name { color: #14161a; font-weight: 600; }
.swagger-ui .parameter__type { color: #0a5bd6; }
.swagger-ui .response-col_status { color: #14161a; }

/* Models */
.swagger-ui .model-box, .swagger-ui section.models {
  background: #fafbfc; border: 1px solid #e7e9ee; border-radius: 12px;
}
.swagger-ui section.models .model-container { background: #ffffff; }
.swagger-ui .model-title, .swagger-ui .model { color: #14161a; }
.swagger-ui .prop-type { color: #0a5bd6; }

/* Code / example blocks */
.swagger-ui .highlight-code, .swagger-ui .microlight {
  background: #14161a; border-radius: 10px;
}
.swagger-ui .responses-inner { padding: 14px 8px; }

/* ---------- dark mode (OS-driven, best-effort) ---------- */
@media (prefers-color-scheme: dark) {
  body { background: #0d0e11; }
  .swagger-ui, .swagger-ui .info .title, .swagger-ui .opblock-tag,
  .swagger-ui .opblock .opblock-summary-path, .swagger-ui .opblock-summary-description,
  .swagger-ui .parameter__name, .swagger-ui .response-col_status,
  .swagger-ui .opblock-section-header h4, .swagger-ui .tab li,
  .swagger-ui .model-title, .swagger-ui .model, .swagger-ui .renderedMarkdown p,
  .swagger-ui .opblock-body { color: #f3f4f7; }
  .swagger-ui .info::before { color: #f3f4f7; }
  .swagger-ui .info .description, .swagger-ui .info .description p,
  .swagger-ui .info li, .swagger-ui .opblock-tag small,
  .swagger-ui table thead tr th { color: #a6acb9; }
  .swagger-ui .info a, .swagger-ui a, .swagger-ui .parameter__type,
  .swagger-ui .prop-type { color: #4d92f2; }
  .swagger-ui .opblock { background: #16181d; border-color: #262a31; }
  .swagger-ui .opblock .opblock-summary { border-color: #262a31; }
  .swagger-ui .opblock-section-header { background: #1d2026; }
  .swagger-ui .opblock-section-header h4 { color: #f3f4f7; }
  .swagger-ui .model-box, .swagger-ui section.models { background: #1d2026; border-color: #262a31; }
  .swagger-ui section.models .model-container { background: #16181d; }
  .swagger-ui section.models .model-container:hover { background: #1d2026; }
  .swagger-ui table thead tr th, .swagger-ui table thead tr td { border-color: #262a31; }
  .swagger-ui .parameters-col_description input { background: #16181d; color: #f3f4f7; border-color: #262a31; }
  .swagger-ui .info .description code { background: #262a31; color: #f3f4f7; }
  .swagger-ui .tab li.active { color: #f3f4f7; }
  .swagger-ui .opblock.opblock-get { background: rgba(43,123,228,.08); }
  .swagger-ui .opblock.opblock-post { background: rgba(30,158,106,.08); }
  .swagger-ui svg:not(:root) { fill: #a6acb9; }
}
`;
