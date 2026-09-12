import { describe, it, expect } from 'vitest'
import { getLoansAppUrl, DEFAULT_LOANS_APP_URL } from '../loansApp'

describe('loansApp', () => {
  it('builds the loans URL with the ingestion_id query param', () => {
    const url = getLoansAppUrl('ing-123')
    expect(url).toContain('ingestion_id=ing-123')
    expect(url.startsWith(DEFAULT_LOANS_APP_URL)).toBe(true)
  })

  it('prefers window.authConfig.loansAppUrl over defaults', () => {
    ;(window as any).authConfig = { loansAppUrl: 'https://loans.example.com/ingest' }
    try {
      const url = getLoansAppUrl('abc')
      expect(url).toBe('https://loans.example.com/ingest?ingestion_id=abc')
    } finally {
      delete (window as any).authConfig
    }
  })
})
