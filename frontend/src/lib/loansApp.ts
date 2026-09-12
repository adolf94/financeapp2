/**
 * Resolves the external Loans App endpoint for an ingestion.
 * The Loans App URL is configured at runtime via window.authConfig.loansAppUrl
 * (authConfig/config.js, injected per-environment by the CI pipelines).
 */
export const DEFAULT_LOANS_APP_URL = 'http://localhost:5173/loans'

export function getLoansAppBaseUrl(): string {
  return window.authConfig?.loansAppUrl || DEFAULT_LOANS_APP_URL
}

export function getLoansAppUrl(ingestionId: string): string {
  const url = new URL(getLoansAppBaseUrl())
  url.searchParams.set('ingestion_id', ingestionId)
  return url.toString()
}
