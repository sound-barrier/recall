// Per-card UI state for the Unknown tab's expandable-card layout.
// Previously bundled refs + callbacks together, which forced
// consumers into `.value` access inside scripts and bare `[]`
// indexing in templates — Vue's auto-unwrap doesn't reach refs
// nested inside object props, so the inconsistency was a steady
// papercut.
//
// Post-item-8 (TECHNICAL_DEBT.md): every field is a function. No
// `.value` gymnastics in consumers, no mixed-shape ambiguity.
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
