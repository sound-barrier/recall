/**
 * Subsequence scoring for the command palette.
 *
 * Hand-written rather than a dependency: the repo requires approval for a new
 * npm package, and the whole need here is "does this query appear in order
 * inside this label, and how tightly" — a few dozen lines, against a corpus of
 * hundreds of items, typed a character at a time.
 *
 * Subsequence rather than substring because a palette's value is typing "wbh"
 * and reaching "Win-rate by hero". Substring matching would make that a miss
 * and leave the user typing the label out in full, which is what the menu they
 * already have is for.
 */

export interface Scored {
  score: number
  // Indices in the haystack that matched, so the UI can bold them. A match the
  // user cannot see the shape of reads as a random result.
  hits: number[]
}

// Contiguity is worth more than position, and a match at a word boundary is
// worth more than one mid-word — "hero" should beat "the*ro*ug*h*" for "hero".
const ADJACENT_BONUS = 8
const BOUNDARY_BONUS = 6
const LEADING_PENALTY = 1

function isBoundary(hay: string, i: number): boolean {
  if (i === 0) return true
  const prev = hay[i - 1] ?? ''
  return prev === ' ' || prev === '-' || prev === '·' || prev === '/'
}

/**
 * Score `query` against `hay`, or return null when the query is not a
 * subsequence of it.
 *
 * Case-insensitive. An empty query matches everything with score 0, which lets
 * the palette show its full corpus before the user types.
 */
export function scoreMatch(query: string, hay: string): Scored | null {
  const q = query.trim().toLowerCase()
  if (q === '') return { score: 0, hits: [] }
  const h = hay.toLowerCase()

  const hits: number[] = []
  let score = 0
  let from = 0
  for (const ch of q) {
    const at = h.indexOf(ch, from)
    if (at < 0) return null
    if (hits.length > 0 && at === hits[hits.length - 1]! + 1) score += ADJACENT_BONUS
    if (isBoundary(h, at)) score += BOUNDARY_BONUS
    // A match that starts deep in the string is weaker than one starting at the
    // front — but ONLY when it starts mid-word. Penalizing a word-boundary
    // start for being late made "Un[map]ped" outrank "by [map]", which is
    // backwards: landing on a word is the stronger signal, wherever it sits.
    if (hits.length === 0 && !isBoundary(h, at)) score -= Math.min(at, 20) * LEADING_PENALTY
    hits.push(at)
    from = at + 1
  }
  // Shorter labels win ties: "Ana" should outrank "Analysis settings" for "ana".
  score -= Math.min(hay.length, 60) / 10
  return { score, hits }
}
