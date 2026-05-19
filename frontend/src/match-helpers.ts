// Pure helpers extracted from App.vue so they can be unit-tested
// independently. Anything UI-stateful (reactive refs, computed) stays
// in App.vue; everything here takes plain inputs and returns plain
// outputs.

import type { MatchRecord, HeroPlay, ScreenshotType } from './api'

export interface ScreenshotSlot {
  key: ScreenshotType
  label: string
  required: boolean
  present: boolean
  hint: string
  missing: string
}

// The four canonical OW post-match screenshot types our parser
// classifies into. Order is workflow order: SUMMARY (post-match
// summary tab) → TEAMS (post-match scoreboard / in-game scoreboard) →
// PERSONAL (per-hero stats tab) → RANK (competitive rank screen).
export const SCREENSHOT_TYPES: ScreenshotType[] = ['summary', 'scoreboard', 'personal', 'rank']

// Pretty label for a screenshot-type value. "scoreboard" is rendered
// as "TEAMS" everywhere else in the app so its filter chip matches.
export function sshotTypeLabel(t: string | null | undefined): string {
  if (t === 'scoreboard') return 'TEAMS'
  return (t || 'unknown').toUpperCase()
}

// Look up the parser-assigned type for a specific source file on a
// record. Returns '' (empty string) for files parsed before per-file
// type tracking landed — the UI renders a "?" chip in that case.
export function sourceType(
  rec: Pick<MatchRecord, 'source_types'> | null | undefined,
  filename: string,
): ScreenshotType | '' {
  return rec?.source_types?.[filename] ?? ''
}

// Infer which screenshot types were parsed for a record. Drives the
// slot-chip row at the top of the Source Screenshots section and the
// missing-data explainer beneath the file list.
//
// `required: true` means a complete match needs that screenshot
// (SUMMARY / TEAMS / PERSONAL). `required: false` is RANK — useful
// but not strictly needed.
//
// When the row carries a stored source_types map (populated at parse
// time from each individual file's classifier), that map is the
// source of truth — a chip is PRESENT iff at least one source file
// is tagged with that type. For pre-migration rows (no source_types)
// we fall back to field-presence inference, which is fuzzier —
// read-time inferences like inferResultFromRank can falsely light up
// SUMMARY, and a scoreboard-only row will light up PERSONAL because
// the scoreboard's right-panel stats are stored in
// HeroesPlayed[*].Stats.
export function detectScreenshotSlots(rec: Pick<MatchRecord, 'data' | 'source_types'>): ScreenshotSlot[] {
  const d = rec.data ?? {}
  const hp = Array.isArray(d.heroes_played) ? d.heroes_played : []
  const storedTypes = rec.source_types
    ? new Set(Object.values(rec.source_types).filter(Boolean))
    : null
  const combatTotal = (d.eliminations ?? 0) + (d.assists ?? 0) + (d.deaths ?? 0) +
                      (d.damage ?? 0) + (d.healing ?? 0) + (d.mitigation ?? 0)
  const presence = (key: ScreenshotType, fallback: boolean): boolean =>
    storedTypes ? storedTypes.has(key) : fallback
  return [
    {
      key: 'summary',
      label: 'SUMMARY',
      required: true,
      present: presence('summary',
        !!(d.final_score || d.date || d.finished_at || d.game_length ||
           d.type || d.mode ||
           hp.some(h => h.percent_played || h.play_time))),
      hint: 'Post-match SUMMARY tab — match result, final score, date, game length',
      missing: 'match result, final score, date & time, game length',
    },
    {
      key: 'scoreboard',
      label: 'TEAMS',
      required: true,
      present: presence('scoreboard', combatTotal > 0),
      hint: 'TEAMS scoreboard (in-game or post-match) — E/A/D, damage, healing, mitigation',
      missing: 'eliminations, assists, deaths, damage, healing, mitigation',
    },
    {
      key: 'personal',
      label: 'PERSONAL',
      required: true,
      present: presence('personal',
        hp.some(h => h.stats && Object.keys(h.stats).length > 0) && combatTotal === 0),
      hint: 'Post-match PERSONAL tab — per-hero detailed stats (accuracy, ult charges, role-specific cards)',
      missing: 'per-hero detailed stats (accuracy, ult charges, role-specific cards)',
    },
    {
      key: 'rank',
      label: 'RANK',
      required: false,
      present: presence('rank',
        !!(d.rank || d.level || (Array.isArray(d.sr) && d.sr.length > 0))),
      hint: 'Competitive rank screen — SR, rank tier, rank change. Optional but recommended for ranked matches.',
      missing: 'SR / rank tier / rank change',
    },
  ]
}

export function missingRequiredSlots(rec: Pick<MatchRecord, 'data' | 'source_types'>): ScreenshotSlot[] {
  return detectScreenshotSlots(rec).filter(s => s.required && !s.present)
}

export function missingOptionalSlots(rec: Pick<MatchRecord, 'data' | 'source_types'>): ScreenshotSlot[] {
  return detectScreenshotSlots(rec).filter(s => !s.required && !s.present)
}

// Heroes need a custom collector — uniqueValues('hero') would only
// pick up the primary/most-played hero on each row. Returns the list
// sorted by percent_played descending. Multi-hero matches (with a
// SUMMARY or PERSONAL screenshot) get the full list; a fallback for
// matches that only have the scoreboard parsed returns the single
// primary hero so the title isn't empty.
export function heroesForHeader(rec: Pick<MatchRecord, 'data'>): HeroPlay[] {
  const list = rec.data?.heroes_played
  if (Array.isArray(list) && list.length > 0) {
    return [...list].sort((a, b) => (b.percent_played ?? 0) - (a.percent_played ?? 0))
  }
  if (rec.data?.hero) return [{ hero: rec.data.hero, percent_played: 0 }]
  return []
}

// matchTime returns a sortable string for a record. Prefers SUMMARY's
// date + finished_at (most accurate); falls back to the match_key
// prefix (set from the earliest screenshot's filename) when SUMMARY
// isn't present.
export function matchTime(rec: Pick<MatchRecord, 'match_key' | 'data'>): string {
  const d = rec.data ?? {}
  if (d.date && d.finished_at) return `${d.date}T${d.finished_at}`
  const m = (rec.match_key ?? '').match(/^match:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/)
  return m ? m[1]! : ''
}

// Format the match's date + end time for the card header. Parser
// stores date as YYYY-MM-DD and finished_at as 24-hour HH:MM; the
// Wails UI prefers a friendlier `May 9, 2026 @ 9:08pm` rendering.
export function fmtTime(rec: Pick<MatchRecord, 'data'>): string {
  const d = rec.data ?? {}
  if (!d.date && !d.finished_at) return ''

  // Date portion: "May 9, 2026". Full month names; day not zero-padded.
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December']
  let datePart = ''
  if (d.date) {
    const [yStr = '', moStr = '', dayStr = ''] = d.date.split('-')
    const y = Number(yStr), mo = Number(moStr), day = Number(dayStr)
    if (!Number.isNaN(y) && !Number.isNaN(mo) && !Number.isNaN(day) && mo >= 1 && mo <= 12) {
      datePart = `${months[mo - 1]!} ${day}, ${y}`
    }
  }

  // Time portion: "9:08pm". Falls back to raw HH:MM if parsing fails.
  let timePart = ''
  if (d.finished_at) {
    const [hStr = '', mStr = ''] = d.finished_at.split(':')
    const h = Number(hStr), m = Number(mStr)
    if (Number.isNaN(h) || Number.isNaN(m)) {
      timePart = d.finished_at
    } else {
      const suffix = h >= 12 ? 'pm' : 'am'
      let hr12 = h % 12
      if (hr12 === 0) hr12 = 12
      timePart = `${hr12}:${String(m).padStart(2, '0')}${suffix}`
    }
  }

  if (datePart && timePart) return `${datePart} @ ${timePart}`
  return datePart || timePart
}
