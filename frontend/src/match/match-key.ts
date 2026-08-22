// Typed form of the stringly-typed `match_key` identity. Mirrors
// pkg/match/match_key.go on the Go side — same kind enum, same four
// prefixes, same Filename / String helpers. The wire format is the
// authority; this module is the parser + constructors that keep
// consumers from open-coding `strings.startsWith('ambiguous-')`.
//
// `replay` is the newest kind and the only one the parser never mints: it
// is derived from the six characters of a replay code, so a coach and a
// player on different machines arrive at the same key. See the Go file for
// why that correspondence is the whole point.
//
// Adopt this at any new site that branches on the prefix. Existing
// sites migrate one PR at a time — the helpers are non-breaking.

type MatchKeyKind = 'tracked' | 'unmatched' | 'ambiguous' | 'replay'

export interface MatchKey {
  kind: MatchKeyKind
  // The original wire-format string, preserved so toString round-
  // trips. Cheaper than re-formatting from kind + body, and lets
  // shape oddities (case, trailing dots) carry forward rather than
  // get swallowed in the parse → render cycle.
  raw: string
  // The portion after the kind prefix — the timestamp for tracked
  // keys; the base64url-encoded filename for unmatched / ambiguous
  // (the Go side decodes it; the frontend treats it as opaque); the
  // canonical replay code for replay keys.
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
 * InvalidMatchKeyError when `s` doesn't carry one of the four known
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
  if (s.startsWith('replay-')) {
    return { kind: 'replay', raw: s, body: s.slice('replay-'.length) }
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

export function isReplayMatchKey(s: string): boolean {
  return s.startsWith('replay-')
}

/**
 * Whether a note may be written about this match — the frontend twin of
 * coach.IsReviewableMatchKey.
 *
 * Deliberately NOT a widened `isTrackedMatchKey`: a replay match is not
 * tracked, it has no screenshot and no timestamp, and every existing caller
 * of `isTrackedMatchKey` means the narrow thing. Reviewability is a second
 * question that happens to have a wider answer.
 */
export function isReviewableMatchKey(s: string): boolean {
  return isTrackedMatchKey(s) || isReplayMatchKey(s)
}
