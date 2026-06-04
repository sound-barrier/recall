// Per-card UI state for the Unknown tab's expandable-card layout.
// Every field is a function so Vue's auto-unwrap (which doesn't
// reach refs nested inside object props) isn't load-bearing —
// consumers don't have to mix `.value` access in `<script setup>`
// with bare `[]` indexing in templates.
//
// MatchesView no longer needs this — the new set-workspace
// renders compact leaf rows that drill into MatchDetailPanel on
// click, with no per-row expand or preview state. Only
// UnknownMapsView consumes the bundle today.

export interface CardStateApi {
  isSelected:      (id: string) => boolean
  isSourcesOpen:   (id: string) => boolean
  isPreviewOpen:   (filename: string) => boolean
  hasPreviewError: (filename: string) => boolean
  toggleExpand:    (id: string) => void
  toggleSources:   (id: string) => void
  togglePreview:   (filename: string) => void
  onPreviewError:  (filename: string) => void
}
