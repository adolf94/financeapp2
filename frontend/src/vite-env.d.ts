/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_INGESTER_BASE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  authConfig?: {
    authority: string
    clientId: string
    redirectUri: string
    scope: string
    apiBaseUrl: string
    ingesterBaseUrl?: string
    loansAppUrl?: string
  }
}
