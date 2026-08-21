import type { FocusItem, MatchRecord } from '@/api-client'
import type { CoachMoment } from '@/match/coach/coach-moments'
import type { CoachNoteDraft } from '@/match/coach/coach-notes'

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

/**
 * How a save reads to the coach. Shared rather than spelled per surface: the
 * note editor and the session summary both autosave through the same queue,
 * and two vocabularies for one mechanism is how "Saved" comes to mean
 * different things in two boxes on the same sheet.
 */
export const SAVE_LABEL: Record<CoachSaveState, string> = {
  idle: 'Autosaves as you write',
  saving: 'Saving\u2026',
  saved: 'Saved',
  error: 'Not saved \u2014 try again',
}

/**
 * Whose matches the room is showing, as the copy speaks of them: someone
 * else's ("Sable's clock", "Sable's own note") or the viewer's own ("your
 * clock", "your own note"). A coach's session is 'their'; the player's own
 * review sitting is 'your'. Only the possessives and the reel's title move —
 * the desk, the editor and the strip are one component either way.
 */
export type RoomVoice = 'their' | 'your'

/**
 * The corpus a review room reads and writes, as one bundle.
 *
 * Two stores drive this room — a coach's session over a loaned bundle, and the
 * player's own sitting — and both exposed the identical ten members, which two
 * call sites then spelled out as six props and four handlers each. That is a
 * data clump: the members always travel together because they are one thing,
 * the corpus under review.
 *
 * EVERY FIELD IS A FUNCTION, the same convention CardStateApi documents: Vue's
 * auto-unwrap does not reach refs nested inside an object prop, so a bundle of
 * refs would force `.value` in `<script setup>` and bare access in templates
 * for the same member. Functions make the unwrap rule irrelevant — and, as a
 * consequence, mean the bundle carries no refs for Pinia's `reactive()` to
 * deep-unwrap on the way out of a store.
 */
export interface RoomApi {
  /** The records under review — a coach's loaned corpus, or your own set. */
  records: () => MatchRecord[]
  /** Drafts keyed by match key. */
  notes: () => Record<string, CoachNoteDraft>
  /** Moments keyed by match key — several per match. */
  moments: () => Record<string, CoachMoment[]>
  /** The frame the reel is on. */
  selectedKey: () => string
  focusItems: () => FocusItem[]
  /** Where one key's autosave stands. Moments queue under their own keys. */
  saveStateFor: (key: string) => CoachSaveState
  selectKey: (matchKey: string) => void
  updateNote: (matchKey: string, draft: CoachNoteDraft) => void
  updateMoment: (matchKey: string, moment: CoachMoment) => void
  removeMoment: (matchKey: string, momentId: string) => void
}
