import type { MatchRecord } from '@/api-client'

// Progress event for a parse run — emitted over the SSE / Wails event stream and
// surfaced by the ingest progress panel, the masthead chip, and the Settings →
// Advanced re-parse line. Lives in a .ts module (not the SFC `<script>`) so every
// consumer — and typescript-eslint's type-aware rules — resolves it cleanly.
export interface ParseProgressEvent {
  done: number
  total: number
  filename: string
  screenshot_type?: string
  data?: MatchRecord['data']
  // Cumulative re-parse counters — surfaced by the Settings →
  // Advanced re-parse-all progress line as "X of Y matches updated".
  // Always 0 on a regular Parse run (no diff to count), so consumers
  // that don't read them silently ignore.
  matches_updated?: number
  hero_corrections?: number
  map_corrections?: number
}
