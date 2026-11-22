/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the backend. Empty in dev: the Vite proxy forwards /api. */
  readonly VITE_API_URL?: string;
  /** OAuth Client ID (type "Web application") for Google sign-in. The Google button is hidden when unset. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
