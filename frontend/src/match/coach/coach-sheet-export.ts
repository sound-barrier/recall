import { buildCoachSheet, toSheetInput, type SheetSource } from '@/match/coach/coach-sheet'
import { COACH_SHEET_CSS } from '@/match/coach/coach-sheet-css'

/**
 * The one lazy entrypoint for building a coach's sheet.
 *
 * Exists to be a CHUNK BOUNDARY, not just for tidiness. The store used to
 * dynamically import the builder and the CSS separately; the CSS got its own
 * chunk, but the builder was hoisted into the ENTRY chunk because it shares
 * `render-markdown` with code the app loads at startup. Rollup will do that
 * whenever a dynamically-imported module's dependencies are already in the
 * main graph — the import being `await import(...)` is not by itself a
 * promise that the module stays out of the entry.
 *
 * Importing both through one module gives the bundler a single unit to move,
 * and it moves it. Measured, not assumed: `scripts/ci/check-bundle-size.sh`
 * is what says so.
 */
export function renderCoachSheet(source: SheetSource): string {
  return buildCoachSheet(toSheetInput(source), COACH_SHEET_CSS)
}
