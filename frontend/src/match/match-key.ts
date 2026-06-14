// Typed form of the stringly-typed `match_key` identity. Mirrors
// pkg/app/match_key.go on the Go side — same kind enum, same three
// prefixes, same Filename / String helpers. The wire format is the
// authority; this module is the parser + constructors that keep
// consumers from open-coding `strings.startsWith('ambiguous-')`.
//
// Adopt this at any new site that branches on the prefix. Existing
// sites migrate one PR at a time — the helpers are non-breaking.

type MatchKeyKind = 'tracked' | 'unmatched' | 'ambiguous'

export interface MatchKey {
  kind: MatchKeyKind
  // The original wire-format string, preserved so toString round-
  // trips. Cheaper than re-formatting from kind + body, and lets
  // shape oddities (case, trailing dots) carry forward rather than
  // get swallowed in the parse → render cycle.
  raw: string
  // The portion after the kind prefix — the timestamp for tracked
  // keys, the screenshot filename for unmatched / ambiguous.
  body: string
}

export class InvalidMatchKeyError extends Error {
  constructor(public readonly input: string) {
    super(`invalid match key: ${JSON.stringify(input)}`)
    this.name = 'InvalidMatchKeyError'
  }
}

/**
 * parseMatchKey returns the typed form of `s` or throws
 * InvalidMatchKeyError when `s` doesn't carry one of the three known
 * prefixes. Throwing rather than returning a union keeps the call
 * sites compact — the unknown case is genuinely exceptional, not a
 * routine branch.
 */
export function parseMatchKey(s: string): MatchKey {
  if (s.startsWith('match-')) {
    return { kind: 'tracked', raw: s, body: s.slice('match-'.length) }
  }
  if (s.startsWith('unmatched-')) {
    return { kind: 'unmatched', raw: s, body: s.slice('unmatched-'.length) }
  }
  if (s.startsWith('ambiguous-')) {
    return { kind: 'ambiguous', raw: s, body: s.slice('ambiguous-'.length) }
  }
  throw new InvalidMatchKeyError(s)
}

/**
 * tryParseMatchKey is the throw-free variant — returns null for an
 * unknown prefix. Use this when the call site wants a single ternary
 * over the result and doesn't care about distinguishing "absent"
 * from "malformed".
 */
export function tryParseMatchKey(s: string): MatchKey | null {
  try {
    return parseMatchKey(s)
  } catch {
    return null
  }
}

export function isAmbiguousMatchKey(s: string): boolean {
  return s.startsWith('ambiguous-')
}

export function isUnmatchedMatchKey(s: string): boolean {
  return s.startsWith('unmatched-')
}

export function isTrackedMatchKey(s: string): boolean {
  return s.startsWith('match-')
}

/**
 * filenameFromMatchKey returns the filename body of an unmatched
 * or ambiguous key, or null otherwise. Convenience wrapper around
 * parseMatchKey for the common "give me the filename" branch.
 */
export function filenameFromMatchKey(s: string): string | null {
  const mk = tryParseMatchKey(s)
  if (!mk) return null
  if (mk.kind === 'ambiguous' || mk.kind === 'unmatched') return mk.body
  return null
}
