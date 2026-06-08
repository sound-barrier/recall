// Label formatters for match metadata that flow through chooser
// menus, leaf-row chips, narrow-panel sections, and the detail
// panel. Each helper accepts the narrowest record shape it actually
// reads (Law of Demeter) so callers — and tests — can pass terse
// fixtures.

import type { MatchRecord } from './api'

// Leaf-row chip label for the play-mode pivot. Prefers the user
// override (`record.play_mode` — set via the right-panel chooser)
// and falls back to the OCR-derived `data.mode` so a freshly-parsed
// match still surfaces its mode without a manual toggle. Returns
// "Unknown mode" when neither is set, so every row carries a chip
// — a glance down the column stays aligned.
export function formatPlayModeLabel(
  rec: Pick<MatchRecord, 'play_mode' | 'data'>,
): string {
  const m = rec.play_mode ?? rec.data?.mode
  if (m === 'quickplay')   return 'Quickplay'
  if (m === 'competitive') return 'Competitive'
  return 'Unknown mode'
}

// Leaf-row chip label for the queue-type pivot. Only sourced from
// the user override (`record.queue_type` — no OCR fallback exists
// for this dimension). "Unknown mode type" matches the spelling
// the leaf row uses for the play-mode fallback so a glance down
// the row reads as one family.
export function formatQueueTypeLabel(
  rec: Pick<MatchRecord, 'queue_type'>,
): string {
  if (rec.queue_type === 'role') return 'Role Queue'
  if (rec.queue_type === 'open') return 'Open Queue'
  return 'Unknown mode type'
}

// Leaf-row chip label for an Unknown hero. Renders "Unknown hero
// (miyazaki?)" when the raw OCR is preserved, plain "Unknown hero"
// when it isn't (e.g. a pre-fix record where hero_raw was discarded).
// The parenthesised raw text gives the user something to recognise
// AND signals to the maintainer what new heroes need adding to the
// YAML when this surfaces in the Unknown tab.
export function formatUnknownHeroLabel(rec: Pick<MatchRecord, 'data'>): string {
  const raw = rec.data?.hero_raw
  if (raw) return `Unknown hero (${raw}?)`
  return 'Unknown hero'
}

export function formatUnknownMapLabel(rec: Pick<MatchRecord, 'data'>): string {
  const raw = rec.data?.map_raw
  if (raw) return `Unknown map (${raw}?)`
  return 'Unknown map'
}
