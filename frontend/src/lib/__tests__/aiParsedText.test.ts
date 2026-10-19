import { describe, it, expect } from 'vitest'
import { mergeSummaryNotes } from '../aiParsedText'

describe('mergeSummaryNotes', () => {
  it('merges distinct summary and notes', () => {
    expect(mergeSummaryNotes('Paid at Starbucks', 'Parsed from receipt image')).toBe(
      'Paid at Starbucks — Parsed from receipt image'
    )
  })

  it('dedupes when notes repeats the summary (case-insensitive)', () => {
    expect(mergeSummaryNotes('Paid at Starbucks', 'paid at starbucks')).toBe('Paid at Starbucks')
  })

  it('returns summary alone when notes is empty', () => {
    expect(mergeSummaryNotes('Paid at Starbucks', null)).toBe('Paid at Starbucks')
    expect(mergeSummaryNotes('Paid at Starbucks', '   ')).toBe('Paid at Starbucks')
  })

  it('returns notes alone when summary is empty', () => {
    expect(mergeSummaryNotes(null, 'AI could not select valid accounts — please pick accounts manually')).toBe(
      'AI could not select valid accounts — please pick accounts manually'
    )
  })

  it('falls back when both are empty', () => {
    expect(mergeSummaryNotes(null, null, 'raw message')).toBe('raw message')
    expect(mergeSummaryNotes('', '', ' raw message ')).toBe('raw message')
    expect(mergeSummaryNotes(null, null)).toBe('')
  })

  it('trims surrounding whitespace', () => {
    expect(mergeSummaryNotes('  Summary  ', '  Note  ')).toBe('Summary — Note')
  })
})
