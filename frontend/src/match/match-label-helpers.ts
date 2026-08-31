// Label formatters for match metadata that flow through chooser
// menus, leaf-row chips, narrow-panel sections, and the detail
// panel. Each helper accepts the narrowest record shape it actually
// reads (Law of Demeter) so callers — and tests — can pass terse
// fixtures.

import type { MatchRecord } from '@/api-client'

/**
 * `n` with the right noun for it.
 *
 * Here rather than beside the review labels that mostly use it, because this
 * module imports nothing at runtime and the reviews one imports date
 * formatting. `CoachInboxBanner` is in App.vue's static graph, so pulling
 * `pluralize` from a module that reaches match-time-helpers put 2.5 KB of date
 * code into the entry chunk — for a nine-line string helper.
 */
export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`
}

// Leaf-row chip label for the play-mode pivot. Prefers the user
// override (`record.play_mode` — set via the right-panel chooser)
// and falls back to the OCR-derived `data.playlist` so a freshly-parsed
// match still surfaces its mode without a manual toggle. Returns
// "Unknown mode" when neither is set, so every row carries a chip
// — a glance down the column stays aligned.
export function formatPlayModeLabel(
  rec: Pick<MatchRecord, 'play_mode' | 'data'>,
): string {
  const m = rec.play_mode ?? rec.data?.playlist
  if (m === 'quickplay')   return 'Quickplay'
  if (m === 'competitive') return 'Competitive'
  return 'Unknown mode'
}

// Leaf-row chip label for the queue-type pivot. `record.queue_type`
// is the effective value — auto-detected from the scoreboard's
// players-per-team, with a user override winning when set. "Unknown
// mode type" matches the spelling the leaf row uses for the play-mode
// fallback so a glance down the row reads as one family.
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
// The parenthesized raw text gives the user something to recognize
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

/**
 * What to say when a bulk dismiss only partly landed.
 *
 * The count is the point: a sweep over a folder can fail on its ninth file,
 * and "could not dismiss 1 of 40" tells the reader both that most of it
 * worked and that something is still there. One failure keeps its own words,
 * because with a single cause the cause is the useful part.
 */
export function dismissFailureMessage(attempted: number, failures: readonly string[]): string {
  const head = `Could not dismiss ${failures.length} of ${pluralize(attempted, 'screenshot')}`
  return failures.length === 1 ? `${head} — ${failures[0]}` : head
}
