import type { Ref } from 'vue'

// Per-card UI state shared with views that render the legacy
// expandable-card layout (currently only UnknownMapsView). The
// shape is bundled into one object so the consumer's prop list
// stays readable — same pattern as FiltersApi / GroupingApi in
// earlier iterations of this app.
//
// MatchesView no longer needs this — the new set-workspace
// renders compact leaf rows that drill into MatchDetailPanel on
// click, with no per-row expand or preview state.
export interface CardStateApi {
  isSelected:    (id: string) => boolean
  isSourcesOpen: (id: string) => boolean
  // Refs (not their unwrapped values) — they're nested inside an
  // object, so Vue's template auto-unwrap doesn't reach them at
  // this depth. Consumers access via `.value`.
  previewOpen:   Ref<Record<string, boolean>>
  previewError:  Ref<Record<string, boolean>>
  toggleExpand:  (id: string) => void
  toggleSources: (id: string) => void
  togglePreview: (filename: string) => void
  onPreviewError: (filename: string) => void
}
