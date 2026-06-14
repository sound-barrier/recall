// Screenshot-type detection + URL building + highlight-substring
// helpers. The screenshot-type family is the core "what was parsed
// for this match" surface (slot chips, missing-data explainer); the
// URL builder + highlight helpers are the two other purely-stateless
// utilities the matches workspace reaches for everywhere.
//
// Topic-specific helpers live in sibling files:
//   - match-label-helpers.ts   — play-mode / queue / unknown labels
//   - match-time-helpers.ts    — match time + clock + relative formats
//   - match-stats-helpers.ts   — W/L/D tally + modeOf + numeric formats
//   - match-group-helpers.ts   — Month → Week → Day grouping

import type { MatchRecord, HeroPlay, ScreenshotType } from '@/api'

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
export const SCREENSHOT_TYPES: ScreenshotType[] = ['summary', 'teams', 'personal', 'rank']

// Pretty label for a screenshot-type value. "teams" is rendered
// as "TEAMS" everywhere else in the app so its filter chip matches.
export function sshotTypeLabel(t: string | null | undefined): string {
  if (t === 'teams') return 'TEAMS'
  return (t || 'unknown').toUpperCase()
}

// Look up the parser-assigned type for a specific source file on a
// record. Parser fills source_types on every ingest, so this is a
// straight map lookup — '' only surfaces if the row lacks the file
// entirely (defensive null-coalesce).
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
// source_types is populated at parse time from each file's
// classifier, so a chip is PRESENT iff at least one source file is
// tagged with that type.
export function detectScreenshotSlots(rec: Pick<MatchRecord, 'data' | 'source_types'>): ScreenshotSlot[] {
  const storedTypes = new Set(Object.values(rec.source_types ?? {}).filter(Boolean))
  return [
    {
      key: 'summary',
      label: 'SUMMARY',
      required: true,
      present: storedTypes.has('summary'),
      hint: 'Post-match SUMMARY tab — match result, final score, date, game length',
      missing: 'match result, final score, date & time, game length',
    },
    {
      key: 'teams',
      label: 'TEAMS',
      required: true,
      present: storedTypes.has('teams'),
      hint: 'TEAMS scoreboard (in-game or post-match) — E/A/D, damage, healing, mitigation',
      missing: 'eliminations, assists, deaths, damage, healing, mitigation',
    },
    {
      key: 'personal',
      label: 'PERSONAL',
      required: true,
      present: storedTypes.has('personal'),
      hint: 'Post-match PERSONAL tab — per-hero detailed stats (accuracy, ult charges, role-specific cards)',
      missing: 'per-hero detailed stats (accuracy, ult charges, role-specific cards)',
    },
    {
      key: 'rank',
      label: 'RANK',
      required: false,
      present: storedTypes.has('rank'),
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

// rolesForHeader walks the same heroes_played order heroesForHeader
// produces and resolves each hero's role via the caller-supplied
// `heroRole` lookup (typically useOWData().heroRole), deduplicating
// while preserving the first-appearance order. Open-queue matches
// can mix any combination of {support, tank, dps} so the leaf row's
// role label needs to list every role the player touched — pre-fix
// the row only showed `data.role`, which is derived from the
// PRIMARY hero alone and silently dropped the secondary roles.
//
// Returns:
//
//   - `[lucio, mercy, dva]`           → `['support', 'tank']`
//   - `[hazard, winston, zen]`        → `['tank', 'support']`
//   - `[lucio, zarya, reaper]`        → `['support', 'tank', 'dps']`
//   - `[]` when neither heroes_played nor `data.role` resolve to
//     anything; the caller decides what to render in that case.
//
// Hero-to-role unknowns (an OCR mangle that doesn't match any
// canonical roster entry) drop out of the list — they'd render as
// an empty chip otherwise.
export function rolesForHeader(
  rec: Pick<MatchRecord, 'data'>,
  heroRole: (hero: string | null | undefined) => string,
): string[] {
  const heroes = heroesForHeader(rec)
  const out: string[] = []
  const seen = new Set<string>()
  for (const h of heroes) {
    const role = heroRole(h.hero)
    if (!role) continue
    if (seen.has(role)) continue
    seen.add(role)
    out.push(role)
  }
  // Fall back to the aggregator-derived single role when no
  // heroes_played entry resolved — matches that only have a
  // scoreboard parsed end up here.
  if (out.length === 0 && rec.data?.role) return [rec.data.role]
  return out
}

// ── Leaf / archive row formatters ──────────────────────────────────
// Shared by the compact match rows (the live leaf row + the archive
// row). Pure given a record (formatRoles also takes the heroRole
// lookup, typically useOWData().heroRole).

// Comma-separated hero list, most-played first. Mirrors
// heroesForHeader's ordering but additionally appends the parsed
// primary (data.hero) when an OCR mismatch left it out of a non-empty
// heroes_played, so the row always surfaces the primary. '—' when
// there's neither a heroes_played entry nor a primary.
export function formatHeroes(rec: Pick<MatchRecord, 'data'>): string {
  const played = [...(rec.data?.heroes_played ?? [])]
  const primary = rec.data?.hero
  if (primary && !played.some((h) => h.hero === primary)) {
    played.push({ hero: primary, percent_played: 0 })
  }
  if (played.length === 0) return '—'
  return played
    .sort((a, b) => (b.percent_played ?? 0) - (a.percent_played ?? 0))
    .map((h) => h.hero)
    .filter(Boolean)
    .join(', ')
}

// Comma-separated role list, deduped in play-order via rolesForHeader.
// '' when nothing resolves — the caller's v-if drops the chip.
export function formatRoles(
  rec: Pick<MatchRecord, 'data'>,
  heroRole: (hero: string | null | undefined) => string,
): string {
  return rolesForHeader(rec, heroRole).join(', ')
}

// Short "Mon D" date from data.date (ISO YYYY-MM-DD). '—' when undated;
// the raw string when unparseable. The YEAR is appended only when the
// date isn't in the current calendar year ("Dec 31, 2025" vs "Jun 3"),
// so a multi-year corpus reads in correct chronological order instead of
// looking scrambled when same-month/day labels collide across years.
export function formatRowDate(rec: Pick<MatchRecord, 'data'>): string {
  const d = rec.data?.date
  if (!d) return '—'
  const dt = new Date(d + 'T00:00:00')
  if (isNaN(dt.getTime())) return d
  const sameYear = dt.getFullYear() === new Date().getFullYear()
  return dt.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}

// Finish time-of-day for a row (data.finished_at), '' when absent.
export function formatFinishedAt(rec: Pick<MatchRecord, 'data'>): string {
  return rec.data?.finished_at ?? ''
}

// isHeroUnknown returns true when the parser captured an OCR'd hero
// name but couldn't pin it to any canonical roster entry (e.g.
// Miyazaki before heroes.yaml was updated). The leaf-row chip + the
// detail-panel banner key on this predicate; the upcoming "verify
// reference data" download surface uses it to count how many records
// would benefit from updating to the latest heroes.yaml.
export function isHeroUnknown(rec: Pick<MatchRecord, 'data'>): boolean {
  return !rec.data?.hero && !!rec.data?.hero_raw
}

export function isMapUnknown(rec: Pick<MatchRecord, 'data'>): boolean {
  return !rec.data?.map && !!rec.data?.map_raw
}

// Build the URL for an on-disk screenshot served by the Go
// ScreenshotHandler. The URL embeds the screenshots_dirs row id so
// the handler can serve from the directory the file was INGESTED
// from, even when the user has since changed their screenshots
// folder (re-install, manual move, profile switch).
//
// `dirID === 0` (or omitted) means "use the currently configured
// screenshots folder" — the fallback path for files that haven't
// been parsed yet (parse-progress inline preview). For aggregated
// records, callers should pass `rec.source_dir_ids?.[filename] ?? 0`.
export function screenshotURL(filename: string, dirID = 0): string {
  return `/_screenshot/${dirID}/${encodeURIComponent(filename)}`
}

// highlightSubstring segments `text` into alternating hit / non-hit
// runs against a (case-insensitive, trimmed) query. Pure — caller
// renders each segment as a <mark> or plain text. Empty text →
// empty array (let the template render the placeholder). Empty
// query → one non-hit segment carrying the whole string.
export interface HighlightSegment {
  text: string
  hit: boolean
}

export function highlightSubstring(text: string, query: string): HighlightSegment[] {
  return highlightSubstrings(text, query ? [query] : [])
}

// highlightSubstrings is the n-term variant. Useful when the search
// query parses into multiple clauses that all want to highlight in
// the same field — feed each clause's value in and the resulting
// segments will mark every hit in one pass.
//
// Each non-hit segment is recursively re-split by the next term, so
// the output is correct even when one term is a substring of another
// (e.g. `["clutch", "lutch"]` produces non-overlapping marks where
// the longer term wins by virtue of being applied first; ordering is
// deterministic by input order).
export function highlightSubstrings(text: string, terms: string[]): HighlightSegment[] {
  if (!text) return []
  const cleaned = terms.map(t => (t ?? '').trim()).filter(t => t.length > 0)
  if (cleaned.length === 0) return [{ text, hit: false }]

  let segments: HighlightSegment[] = [{ text, hit: false }]
  for (const term of cleaned) {
    const needle = term.toLowerCase()
    const next: HighlightSegment[] = []
    for (const seg of segments) {
      if (seg.hit) { next.push(seg); continue }
      const haystack = seg.text.toLowerCase()
      let cursor = 0
      while (cursor < seg.text.length) {
        const idx = haystack.indexOf(needle, cursor)
        if (idx < 0) {
          next.push({ text: seg.text.slice(cursor), hit: false })
          break
        }
        if (idx > cursor) next.push({ text: seg.text.slice(cursor, idx), hit: false })
        next.push({ text: seg.text.slice(idx, idx + needle.length), hit: true })
        cursor = idx + needle.length
      }
    }
    segments = next
  }
  return segments
}
