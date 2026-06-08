import type { MatchRecord } from '../api'
import { screenshotURL } from '../match-helpers'

// Resolve the URL of a match record's SUMMARY screenshot — the
// post-match summary tab is the most recognisable thumbnail (it
// shows the map name + final score + heroes played, so a glance
// reveals "this was the Rialto comeback"). Falls back to the
// TEAMS scoreboard when SUMMARY is missing, then to the first
// source file when neither is classified.
//
// Returns null when the record carries no source files at all
// (newly-parsed unmatched records before their first ingest).
// Used by the leaf-row hover preview (LeafHoverPreview.vue).
export function summaryThumbnailURL(rec: Pick<MatchRecord, 'source_files' | 'source_types' | 'source_dir_ids'>): string | null {
  const files = rec.source_files ?? []
  if (files.length === 0) return null
  const types = rec.source_types ?? {}
  const dirs  = rec.source_dir_ids ?? {}
  // First-pass: a file classified as SUMMARY.
  for (const f of files) {
    if (types[f] === 'summary') return screenshotURL(f, dirs[f] ?? 0)
  }
  // Second-pass: a file classified as SCOREBOARD (TEAMS) — the
  // next most readable thumbnail since it carries E/A/D and the
  // highlighted player row.
  for (const f of files) {
    if (types[f] === 'scoreboard') return screenshotURL(f, dirs[f] ?? 0)
  }
  // Last resort — just take the first source file.
  return screenshotURL(files[0]!, dirs[files[0]!] ?? 0)
}
