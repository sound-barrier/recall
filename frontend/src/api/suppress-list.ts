import { unwrapVoid } from '@/api-unwrap'
import * as sdk from '@/client/sdk.gen'

// Re-exported wire types — consumers import these instead of reaching into
// the generated module directly.

// ─── Screenshots suppress-list ─────────────────────────────────────────────

// Permanently ignore a screenshot — backs the Unknown tab's Dismiss
// affordance. Adds the filename to the suppress-list AND wipes the
// file's own rows (a match with sibling screenshots survives minus this
// file). The on-disk file is NOT deleted. Idempotent.
export function IgnoreScreenshot(filename: string): Promise<void> {
  return unwrapVoid(sdk.ignoreScreenshot({ path: { filename } }))
}

// Restore an ignored screenshot so the next Parse run picks it back up.
// Idempotent on filenames that aren't ignored.
export function UnignoreScreenshot(filename: string): Promise<void> {
  return unwrapVoid(sdk.unignoreScreenshot({ path: { filename } }))
}

// Bulk truncate the suppress-list — Settings panel's "Re-enable all".
export function ClearIgnoredScreenshots(): Promise<void> {
  return unwrapVoid(sdk.clearIgnoredScreenshots())
}
