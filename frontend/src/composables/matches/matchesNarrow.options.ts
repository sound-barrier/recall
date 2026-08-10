// Display options for the Narrow panel's fixed-enum facets. Data only —
// NarrowPopover.vue renders them; the pick handlers cast each chip's
// string value back to its *Pick union.

/**
 * Friendlier labels for the leaver-side chips (the raw enum is terse).
 * The verb only appears on the self chip, matching the existing asymmetry —
 * "Teammate" / "Enemy" read fine bare under a "With a leaver" heading.
 */
export const LEAVER_LABELS: Record<'self' | 'team' | 'enemy', string> = {
  self: 'You left', team: 'Teammate', enemy: 'Enemy',
}

/** Same asymmetry as LEAVER_LABELS, for the thrower-side chips. */
export const THROWER_LABELS: Record<'self' | 'team' | 'enemy', string> = {
  self: 'You threw', team: 'Teammate', enemy: 'Enemy',
}

// Fixed-enum facet options (value = the *Pick union member, label = display
// text).

/** Role/Open queue facet options (QueuePick values). */
export const QUEUE_OPTIONS = [
  { value: 'role', label: 'Role Queue' },
  { value: 'open', label: 'Open Queue' },
  { value: 'unknown', label: 'Unknown mode type' },
]

/** Quickplay/Competitive facet options (PlayModePick values). */
export const PLAY_MODE_OPTIONS = [
  { value: 'quickplay', label: 'Quickplay' },
  { value: 'competitive', label: 'Competitive' },
  { value: 'unknown', label: 'Unknown mode' },
]

/** Reviewed-by facet options (ReviewedByPick values). */
export const REVIEWED_BY_OPTIONS = [
  { value: 'self', label: 'Self' },
  { value: 'coach', label: 'Coach' },
  { value: 'unreviewed', label: 'Unreviewed' },
]

/** Data-provenance facet options (SourcePick values). */
export const PROVENANCE_OPTIONS = [
  { value: 'ocr_edited', label: 'Edited' },
  { value: 'manual', label: 'User entered' },
]
