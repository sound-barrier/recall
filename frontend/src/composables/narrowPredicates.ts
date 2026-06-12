import type { MatchRecord } from '../api'
import { formatPlayModeLabel, formatQueueTypeLabel } from '../match-label-helpers'
import type { SearchClause } from '../search-query'
import type { PlayModePick, QueuePick, ReviewedByPick } from './useMatchesNarrow'

// Per-dimension narrow predicates. Each function is ≤ 15 lines,
// returns `true` if the record passes that dimension's gate, and is
// independently unit-testable. Composed by the main
// `useMatchesNarrow` filter as `predicates.every(p => p(r, …))`.
//
// Extracted from a single 85-complexity arrow function so that:
//   - branch coverage tracks each dimension individually,
//   - adding a new dimension only touches its own predicate file,
//   - the legacy `useMatchFilters` composable's duplicated
//     filter math was deleted entirely — narrowPredicates is the
//     one place dimension semantics live.
//
// Every predicate takes the smallest possible `state` slice so
// callers can construct test states without satisfying fields the
// predicate never reads.

// "M:SS" or "H:MM:SS" → minutes as a float. Bad input reads as 0
// so a non-parseable play_time can't accidentally satisfy the
// min-play threshold. Internal-only — exported via matchesHero,
// not directly.
function parsePlayTimeMinutes(s: string): number {
  if (!s) return 0
  const parts = s.split(':').map((x) => parseInt(x, 10))
  if (parts.some((n) => isNaN(n))) return 0
  if (parts.length === 2) return parts[0]! + parts[1]! / 60
  if (parts.length === 3) return parts[0]! * 60 + parts[1]! + parts[2]! / 60
  return parts[0] ?? 0
}

// matchesSearch gates a record against the parsed search clauses. A
// BARE clause (field === null) substring-matches the broad lexical blob
// (every visible surface); a SCOPED clause matches only its annotation
// surface (note / tag / member / replay). All clauses AND; an empty
// clause list is inert. Clause values are already lower-cased by
// parseSearchQuery, so every surface is lower-cased to compare.
export function matchesSearch(r: MatchRecord, clauses: SearchClause[]): boolean {
  if (clauses.length === 0) return true
  const d = r.data
  if (!d) return false
  const ann = r.annotation
  const heroesPlayedNames = (d.heroes_played ?? []).map((h) => h.hero ?? '').filter(Boolean)
  const note = (ann?.note ?? '').toLowerCase()
  const tags = (ann?.tags ?? []).join(' ').toLowerCase()
  const members = (ann?.members ?? []).join(' ').toLowerCase()
  const replay = (ann?.replay_code ?? '').toLowerCase()
  const blob = [
    d.map, d.playlist, d.hero, d.role, d.game_mode,
    ann?.note,
    ...heroesPlayedNames,
    ...(ann?.tags ?? []),
    ...(ann?.members ?? []),
    ann?.replay_code,
  ].filter(Boolean).join(' ').toLowerCase()
  return clauses.every((c) => {
    switch (c.field) {
      case 'note':   return note.includes(c.value)
      case 'tag':    return tags.includes(c.value)
      case 'member': return members.includes(c.value)
      case 'replay': return replay.includes(c.value)
      default:       return blob.includes(c.value)
    }
  })
}

export function matchesDateRange(r: MatchRecord, fromBound: string, toBound: string): boolean {
  const dateKey = r.data?.date ?? ''
  if (!dateKey) return true
  // Slice the bound strings to YYYY-MM-DD before comparing — the
  // heatmap cell-click writes `${date}T00:00`/`${date}T23:59` for
  // sub-day band selection; preset ranges + the manual datepicker
  // write bare YYYY-MM-DD. A raw lexicographic compare between the
  // two forms drops every record on the active day.
  const from = fromBound.slice(0, 10)
  const to = toBound.slice(0, 10)
  if (from && dateKey < from) return false
  if (to && dateKey > to) return false
  return true
}

export function matchesPickedSet(value: string | undefined, picked: Set<string>): boolean {
  if (!picked.size) return true
  return picked.has(value ?? '')
}

export function matchesHero(
  r: MatchRecord,
  pickedHeroes: Set<string>,
  minPlayMinutes: number,
  minPlayPercent: number,
): boolean {
  if (!pickedHeroes.size) return true
  const d = r.data
  if (!d) return false
  const anyThreshold = minPlayMinutes > 0 || minPlayPercent > 0
  // Broad match: primary hero OR any heroes_played row. With a
  // threshold set, primary-hero-only no longer qualifies — the
  // hero must satisfy a heroes_played threshold. OR semantics
  // between minutes and percent.
  return [...pickedHeroes].some((wanted) => {
    if (d.hero === wanted && !anyThreshold) return true
    return (d.heroes_played ?? []).some((hp) => {
      if (hp.hero !== wanted) return false
      if (!anyThreshold) return true
      const minutes = parsePlayTimeMinutes(hp.play_time ?? '')
      const pct = hp.percent_played ?? 0
      return (minPlayMinutes > 0 && minutes >= minPlayMinutes)
        || (minPlayPercent > 0 && pct >= minPlayPercent)
    })
  })
}

export function matchesTags(r: MatchRecord, pickedTags: Set<string>): boolean {
  if (!pickedTags.size) return true
  const tags = new Set(r.annotation?.tags ?? [])
  return [...pickedTags].some((t) => tags.has(t))
}

// matchesMembers narrows to matches that include EVERY picked teammate
// — AND semantics, not OR like tags. Picking {Alice, Bob} isolates the
// games where both were on the team (the duo/stack), which is the point
// of the dimension: "how does this exact group do?". A single pick
// reduces to "games I played with this person".
export function matchesMembers(r: MatchRecord, pickedMembers: Set<string>): boolean {
  if (!pickedMembers.size) return true
  const members = new Set(r.annotation?.members ?? [])
  return [...pickedMembers].every((m) => members.has(m))
}

export function matchesReviewedBy(r: MatchRecord, picked: Set<ReviewedByPick>): boolean {
  if (!picked.size) return true
  const bucket: ReviewedByPick = r.reviewed_by ?? 'unreviewed'
  return picked.has(bucket)
}

// matchesQueueType narrows to matches whose queue-type BUCKET is in
// the picked set. Buckets are derived via formatQueueTypeLabel so
// the filter agrees with the leaf chip exactly — picking "Role
// Queue" returns rows the leaf reads as "Role Queue", picking
// "Unknown mode type" returns rows the leaf reads as "Unknown mode
// type". Includes an explicit "unknown" bucket (no override, no
// OCR — queue_type has no OCR source today, so equivalent to "no
// override") so users can narrow to the unset slice and bulk-set
// it from the toolbar.
export function matchesQueueType(r: MatchRecord, picked: Set<QueuePick>): boolean {
  if (!picked.size) return true
  const label = formatQueueTypeLabel(r)
  const bucket: QueuePick =
    label === 'Role Queue' ? 'role' :
    label === 'Open Queue' ? 'open' :
    'unknown'
  return picked.has(bucket)
}

// matchesPlayMode narrows to matches whose play-mode BUCKET is in
// the picked set. Same shape as matchesQueueType — derived via
// formatPlayModeLabel so the filter agrees with the leaf chip.
// Pre-fix, this read r.play_mode directly and silently dropped
// OCR-fallback rows the leaf showed as "Competitive", which broke
// the principle that what-you-see is what-you-filter.
export function matchesPlayMode(r: MatchRecord, picked: Set<PlayModePick>): boolean {
  if (!picked.size) return true
  const label = formatPlayModeLabel(r)
  const bucket: PlayModePick =
    label === 'Quickplay'   ? 'quickplay' :
    label === 'Competitive' ? 'competitive' :
    'unknown'
  return picked.has(bucket)
}

// Returns `true` when the record's parsed_at is strictly AFTER the
// anchor's parsed_at. Caller is responsible for resolving the
// `anchorFloor` parsed_at string once per filter pass (looking it
// up here per-record would be O(n²)). `null` floor = no filter
// active (unset anchor, stale anchor key, or sinceAnchorActive=false).
export function matchesSinceAnchor(r: MatchRecord, anchorFloor: string | null): boolean {
  if (anchorFloor === null) return true
  const parsedAt = r.parsed_at ?? ''
  return parsedAt > anchorFloor
}

export function matchesLeaverHandling(r: MatchRecord, mode: 'include' | 'exclude-tally' | 'hide'): boolean {
  if (mode !== 'hide') return true
  return !r.annotation?.leaver
}
