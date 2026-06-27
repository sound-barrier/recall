import type { MatchRecord } from '@/api-client'
import { screenshotURL } from '@/match/match-helpers'

// Resolve the URL of a match record's hover-preview thumbnail.
//
// The server picks the best on-disk screenshot (SUMMARY, else TEAMS, else any
// source file) and reports it as `thumbnail_file` — already verified to exist
// on disk at read time. Returns null when there is none (a manual match, a
// data-only import, or a screenshot deleted/moved off disk), so the preview
// never requests a `/_screenshot/...` URL it knows will 404.
//
// Used by the leaf-row hover preview (LeafHoverPreview.vue).
export function summaryThumbnailURL(rec: Pick<MatchRecord, 'thumbnail_file' | 'source_dir_ids'>): string | null {
  const file = rec.thumbnail_file
  if (!file) return null
  const dirs = rec.source_dir_ids ?? {}
  return screenshotURL(file, dirs[file] ?? 0)
}
