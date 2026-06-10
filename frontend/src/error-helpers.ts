// Map Go-style raw error strings to plain-language CTAs end users
// can act on. Recall's Go backend surfaces errors verbatim via
// `http.Error` / `fmt.Errorf`, so messages like
// "stat /Users/x/Documents: permission denied" reach the user as-is.
// First-time users don't read those as actionable — translate the
// common patterns to language that explains both WHAT is wrong and
// WHAT TO DO next.
//
// Patterns are matched case-insensitively against the full error
// text. The first matching rule wins; rules are ordered most-
// specific → most-general so a more-helpful translation never gets
// shadowed by a generic catch-all.
//
// Unmatched errors fall through unchanged — better to show the raw
// message than to silently swallow context behind a generic
// "Something went wrong."
//
// Pinned by error-helpers.test.ts.

interface ErrorPattern {
  match: RegExp
  // Plain-language rewrite. Receives the original raw error in case
  // the rewrite wants to embed it in parentheses for diagnostic
  // reference (currently no patterns do; reserved for future use).
  rewrite: (raw: string) => string
}

const PATTERNS: readonly ErrorPattern[] = [
  // ── Filesystem permission ────────────────────────────────────────
  {
    match: /permission denied/i,
    rewrite: () =>
      'Cannot access that location. Check that Recall has read access ' +
      'or try a different folder.',
  },
  // ── Not a directory ──────────────────────────────────────────────
  {
    match: /not a directory|is a file/i,
    rewrite: () =>
      'That path points to a file, not a folder. Pick a folder ' +
      'containing your screenshots.',
  },
  // ── Doesn't exist (path or directory) ────────────────────────────
  {
    match: /no such file or directory|cannot find the path|cannot find the file|file does not exist/i,
    rewrite: () =>
      'The folder or file no longer exists. Pick a new one in Settings.',
  },
  // ── Network unreachable / connection refused ─────────────────────
  {
    match: /connection refused|connection reset|network is unreachable|no route to host/i,
    rewrite: () =>
      'Cannot reach the server. Check your network connection and try ' +
      'again.',
  },
  // ── Timeout ──────────────────────────────────────────────────────
  {
    match: /context deadline exceeded|i\/o timeout|request timed out/i,
    rewrite: () =>
      'The operation took too long. Try again, or check your network ' +
      'connection.',
  },
  // ── Tesseract specifics ──────────────────────────────────────────
  {
    match: /tesseract.*(not (?:available|found)|no such file)|exec:.*tesseract/i,
    rewrite: () =>
      'Recall could not run Tesseract. Configure it in Settings → ' +
      'Engine, then try again.',
  },
  // ── Disk full / quota ────────────────────────────────────────────
  {
    match: /no space left on device|disk quota exceeded/i,
    rewrite: () =>
      'Your disk is full. Free up space and try again.',
  },
]

// Translate a raw error to a plain-language message. Returns the
// original string when no pattern matches — preserving diagnostic
// context is better than emitting a generic placeholder.
export function plainLanguageError(raw: string): string {
  for (const p of PATTERNS) {
    if (p.match.test(raw)) return p.rewrite(raw)
  }
  return raw
}
