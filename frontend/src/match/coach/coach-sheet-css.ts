import coachSheet from '@/styles/coach-sheet.css?inline'
import noteProse from '@/styles/note-prose.css?inline'
import paper from '@/styles/paper.css?inline'
import themes from '@/styles/themes.css?inline'
import tokens from '@/styles/tokens.css?inline'

/**
 * The app's real stylesheets, as text, for embedding in the coach's sheet.
 *
 * Vite's `?inline` returns the processed CSS as a string instead of
 * injecting it, so the standalone page paints from the SAME BYTES the app
 * does. That is the entire reason this module exists: the alternative is a
 * hand-copied subset, which is what the Go ledger template did, and which
 * drifted from `note-prose.css` one rule at a time.
 *
 * Two constraints on what may be added to this list:
 *
 *   1. NO `app.css` — it is an `@import` index, and an @import in a
 *      standalone file is an external reach the CSP forbids.
 *   2. NO `style.css` — its `@font-face` rules carry Google `url()`s. The
 *      sheet falls back to a system stack, which is the right trade for a
 *      file that must render with the network off.
 *
 * Both are asserted by the sheet's own test, which fails on `url(` or
 * `@import` appearing anywhere in the output.
 *
 * Kept apart from `coach-sheet.ts` so the builder takes its CSS as an
 * argument and stays pure — under Vitest these imports resolve to the empty
 * string, so a builder that read them directly would make its own security
 * assertions vacuous. The real bytes are proven by the e2e instead.
 */
export const COACH_SHEET_CSS = [tokens, themes, paper, noteProse, coachSheet].join('\n')
