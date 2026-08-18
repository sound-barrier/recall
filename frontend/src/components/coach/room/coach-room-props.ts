// The prop vocabulary the Film Room's components share. Everything in
// `components/coach/` is presentational — props in, events out — so the
// shapes live here rather than in any one SFC (a type exported from a
// `.vue` <script> can't be resolved across the SFC boundary).

/** The player whose bundle is on loan, as the room renders them. */
export interface CoachPlayerView {
  handle: string
  message?: string
}

/** Where the note autosave stands; the editor speaks it through a role=status line. */
export type CoachSaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Canonical display names for the stored lowercase map / hero forms.
 * The room takes them as a prop instead of reading the reference-data
 * query itself, which is what keeps these components free of the api
 * and cache layers.
 */
export interface CoachLabels {
  map: (raw: string | null | undefined) => string
  hero: (raw: string | null | undefined) => string
}

// Fallback for a room whose caller passes no lookups: title-case the
// stored form ("king's row" → "King's Row"). Good enough to read; the
// canonical spellings (D.Va, Soldier: 76) arrive with the real lookups.
function titleCase(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw.replace(/(^|[\s(])([a-z])/g, (_match, lead: string, first: string) => lead + first.toUpperCase())
}

export const DEFAULT_COACH_LABELS: CoachLabels = { map: titleCase, hero: titleCase }
