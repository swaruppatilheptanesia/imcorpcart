/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional API base override. Empty by default — requests go to same-origin
   *  `/api` via the Vite dev proxy. Set for non-proxy/prod deployments. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
