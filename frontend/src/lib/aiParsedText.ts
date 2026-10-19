/**
 * Helpers for composing AI-parsed display text.
 *
 * `AiParsedData.summary` is the concise human-readable transaction summary;
 * `AiParsedData.notes` carries the AI's note plus backend annotations
 * (e.g. "AI could not select valid accounts … — please pick accounts manually").
 * Both come from the AI pipeline, so display surfaces must merge them instead
 * of the old `summary || notes` fallback chain that hid the notes entirely.
 */

export function mergeSummaryNotes(
  summary?: string | null,
  notes?: string | null,
  fallback?: string | null
): string {
  const parts = [summary?.trim(), notes?.trim()].filter(
    (p): p is string => Boolean(p)
  )
  // Dedupe when notes repeats the summary (case-insensitive)
  const unique = parts.filter(
    (p, i) => parts.findIndex(q => q.toLowerCase() === p.toLowerCase()) === i
  )
  const merged = unique.join(' — ')
  return merged || fallback?.trim() || ''
}
