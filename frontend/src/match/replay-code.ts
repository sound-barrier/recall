/**
 * The canonical form of an Overwatch replay code: six uppercase ASCII
 * alphanumerics.
 *
 * This is the TypeScript half of a pair. `match.NormalizeReplayCode` in
 * `pkg/match/replay_code.go` is the other, and the two are held to identical
 * behavior by a shared fixture (`pkg/match/testdata/replay_code_cases.json`).
 *
 * They have to agree exactly, because a replay code is the only token from
 * which a coach and a player — on two installs, in two languages — derive the
 * same match key. If one side accepts a character the other refuses, the
 * coach's note lands on a key that does not exist on the player's machine, and
 * nothing anywhere reports an error.
 *
 * So both character sets are spelled out in ASCII below rather than delegated
 * to a built-in. `trim()` is the one that would actually break the pair: it
 * strips code points Go's ASCII cutset keeps, and a stray non-breaking space
 * would then normalize on one side and not the other.
 *
 * The explicit case-fold is the weaker of the two guards, and worth being
 * honest about: `CANONICAL` has already admitted only ASCII by the time it
 * runs, so `toUpperCase()` would behave identically HERE. It is spelled out
 * anyway because that safety is an ordering accident — Go's equivalent runs
 * BEFORE its character check, where `ToUpper` shrinks `'ſſſ'` from six bytes
 * to three and does change the answer. Neither implementation should depend
 * on the order of its own two guards.
 */

/** Space, tab, newline, carriage return, vertical tab, form feed — and nothing else. */
const ASCII_SPACE = /^[ \t\n\r\v\f]+|[ \t\n\r\v\f]+$/g

/** Exactly six ASCII alphanumerics, anchored. No `\w`, no `u` flag, no surprises. */
const CANONICAL = /^[A-Za-z0-9]{6}$/

/**
 * Canonicalizes a typed replay code.
 *
 * Returns the six-character uppercase form, or `null` if the input is not a
 * replay code at all. An empty string is not a code — callers that treat
 * "no code" as legal check for it themselves before asking.
 */
export function normalizeReplayCode(raw: string): string | null {
  const trimmed = raw.replace(ASCII_SPACE, '')
  if (!CANONICAL.test(trimmed)) return null
  return trimmed.replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 32))
}

/** Whether `raw` is a replay code. Thin, and reads better at a call site. */
export function isReplayCode(raw: string): boolean {
  return normalizeReplayCode(raw) !== null
}

/** How many characters a replay code has. Exported so a field can cap itself. */
export const REPLAY_CODE_LENGTH = 6

/**
 * The in-progress form: what a replay-code field shows while it is still
 * being typed.
 *
 * Unlike `normalizeReplayCode` this never fails, because a half-typed code is
 * not an error — it is a user mid-keystroke. It uppercases, drops characters
 * that can never appear in a code, and stops at six, so the field cannot hold
 * anything the server would refuse. A paste of `a1b2-c3d4` lands as `A1B2C3`.
 */
export function toReplayCodeDraft(raw: string): string {
  return raw
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, REPLAY_CODE_LENGTH)
    .replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 32))
}
