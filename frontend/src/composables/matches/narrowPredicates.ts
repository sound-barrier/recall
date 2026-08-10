import type { MatchRecord } from '@/api-client'
import { rolesForHeader } from '@/match/match-helpers'
import { formatPlayModeLabel, formatQueueTypeLabel } from '@/match/match-label-helpers'
import { matchTime } from '@/match/match-time-helpers'
import { matchStartUTC, inSeasonWindow } from '@/match/match-season-helpers'
import { classifyPoolMembership } from '@/match/match-hero-pool-helpers'
import type { SearchClause } from '@/match/search-query'
import type { PlayModePick, QueuePick, ReviewedByPick, SourcePick } from '@/composables/matches/useMatchesNarrow'
import type { PoolFilter } from '@/composables/matches/matchesNarrow.types'

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
  // Disruption sides are searchable ONLY through their scoped tokens
  // (`leaver:team`, `thrower:enemy`). They stay out of the bare-token blob
  // below on purpose: the values are three generic words, and folding them in
  // would make a search for "self" or "team" match on a tag the user wasn't
  // thinking about.
  const leavers = (ann?.leavers ?? []).join(' ').toLowerCase()
  const throwers = (ann?.throwers ?? []).join(' ').toLowerCase()
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
      case 'leaver': return leavers.includes(c.value)
      case 'thrower': return throwers.includes(c.value)
      default:       return blob.includes(c.value)
    }
  })
}

// matchesDateRange places a record on the naive-local time axis via the
// canonical matchTime() recipe (SUMMARY date+finished_at, else the match
// key's capture timestamp), falling back to bare data.date so dated rows
// without either stamp stay filterable. Records with NO placeable time
// (unmatched-/ambiguous- sentinels) always pass.
//
// Bounds: fromBound/toBound are date strings; the optional fromTime/toTime
// ('HH:MM') tighten their day to a minute boundary — the patch-drop
// primitive the future seasons feature builds on. Contract (also the
// seasons contract): everything is naive LOCAL wall-clock; both ends are
// inclusive; mixed precision resolves by truncating the RECORD to the
// minute (never padding the bound), so `to 10:59` keeps a 10:59:45 match
// — "to 10:59" means the whole closing minute — while `from 11:00`
// excludes 10:59:59.
export interface DateRangeBounds {
  from: string
  to: string
  fromTime?: string
  toTime?: string
}

export function matchesDateRange(r: MatchRecord, bounds: DateRangeBounds): boolean {
  const { from: fromBound, to: toBound, fromTime = '', toTime = '' } = bounds
  const stamp = matchTime(r) || (r.data?.date ?? '')
  if (!stamp) return true
  const minute = stamp.slice(0, 16)
  const date = stamp.slice(0, 10)
  // Slice the bound strings to YYYY-MM-DD before comparing — the
  // heatmap cell-click writes `${date}T00:00`/`${date}T23:59` for
  // sub-day band selection; preset ranges + the manual datepicker
  // write bare YYYY-MM-DD. A raw lexicographic compare between the
  // two forms drops every record on the active day. Sub-day precision
  // comes ONLY from the explicit fromTime/toTime panel inputs.
  const from = fromBound.slice(0, 10)
  const to = toBound.slice(0, 10)
  if (from && (fromTime ? minute < `${from}T${fromTime}` : date < from)) return false
  if (to && (toTime ? minute > `${to}T${toTime}` : date > to)) return false
  return true
}

export function matchesPickedSet(value: string | undefined, picked: Set<string>): boolean {
  if (!picked.size) return true
  return picked.has(value ?? '')
}

// matchesAnySide is the set-valued sibling of matchesPickedSet, for the
// disruption facets (leavers / throwers). A match passes if it carries ANY of
// the picked sides — OR semantics, matching how tags and modifiers behave — so
// a match tagged on both teams surfaces under either pick without counting
// twice. Empty pick set ≡ no filter.
export function matchesAnySide(sides: string[] | undefined, picked: Set<string>): boolean {
  if (!picked.size) return true
  if (!sides?.length) return false
  return sides.some((s) => picked.has(s))
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

// Broad match: ANY role the match played (open-queue matches mix dps/support/
// tank), not just the primary data.role — so clicking a secondary-role chip
// keeps the match instead of hiding it. heroRole resolves heroes_played to roles.
export function matchesRole(
  r: MatchRecord,
  pickedRoles: Set<string>,
  heroRole: (hero: string | null | undefined) => string,
): boolean {
  if (!pickedRoles.size) return true
  return rolesForHeader(r, heroRole).some((role) => pickedRoles.has(role))
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

// matchesModifiers narrows to matches carrying ANY of the picked rank-
// update modifiers (OR, like tags). A match lists several modifiers at
// once, so picking {uphill battle, reversal} surfaces every game that was
// either. The picks come from the non-result modifier vocabulary
// (victory/defeat/draw live on the separate result filter).
export function matchesModifiers(r: MatchRecord, picked: Set<string>): boolean {
  if (!picked.size) return true
  const mods = new Set(r.data?.modifiers ?? [])
  return [...picked].some((m) => mods.has(m))
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
const QUEUE_BUCKETS: Record<string, QueuePick> = { 'Role Queue': 'role', 'Open Queue': 'open' }

export function matchesQueueType(r: MatchRecord, picked: Set<QueuePick>): boolean {
  if (!picked.size) return true
  const bucket = QUEUE_BUCKETS[formatQueueTypeLabel(r)] ?? 'unknown'
  return picked.has(bucket)
}

// matchesPlayMode narrows to matches whose play-mode BUCKET is in
// the picked set. Same shape as matchesQueueType — derived via
// formatPlayModeLabel so the filter agrees with the leaf chip.
// Pre-fix, this read r.play_mode directly and silently dropped
// OCR-fallback rows the leaf showed as "Competitive", which broke
// the principle that what-you-see is what-you-filter.
const PLAY_MODE_BUCKETS: Record<string, PlayModePick> = { Quickplay: 'quickplay', Competitive: 'competitive' }

export function matchesPlayMode(r: MatchRecord, picked: Set<PlayModePick>): boolean {
  if (!picked.size) return true
  const bucket = PLAY_MODE_BUCKETS[formatPlayModeLabel(r)] ?? 'unknown'
  return picked.has(bucket)
}

// matchesSource narrows to matches whose PROVENANCE bucket is in the
// picked set. The bucket is `r.source` falling back to 'ocr' (a pure
// parsed match omits the field). The narrow panel exposes only the
// 'ocr_edited' and 'manual' chips ("Edited" / "User entered"), so a
// non-empty pick set never contains 'ocr' and pure-OCR rows drop out —
// exactly the "show me only the matches I touched" intent.
export function matchesSource(r: MatchRecord, picked: Set<SourcePick>): boolean {
  if (!picked.size) return true
  const bucket: SourcePick = r.source ?? 'ocr'
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

// matchesPickedSeason keeps a match iff its START (matchStartUTC) falls in the
// picked season's [startMs, endMs) window. '' / unknown season / untimed match
// all pass (inert), mirroring the other soft gates. Windows are non-overlapping
// so "start is in the picked window" == "the match's season is the picked one".
export function matchesPickedSeason(
  r: MatchRecord,
  seasonName: string,
  seasonWindow: (name: string) => { startMs: number; endMs: number } | null,
): boolean {
  if (!seasonName) return true
  const w = seasonWindow(seasonName)
  if (!w) return true
  const startMs = matchStartUTC(r)
  if (startMs === null) return true
  return inSeasonWindow(startMs, w)
}

export function matchesLeaverHandling(r: MatchRecord, mode: 'include' | 'exclude-tally' | 'hide'): boolean {
  if (mode !== 'hide') return true
  return !r.annotation?.leavers?.length
}

// matchesPoolSide gates a match against the Hero Pool band's In-pool /
// Out-of-pool selection: classify the record against the snapshotted pool keys
// and keep only the chosen side. A null filter passes everything.
export function matchesPoolSide(r: Pick<MatchRecord, 'data'>, filter: PoolFilter | null): boolean {
  if (!filter) return true
  return classifyPoolMembership(r, new Set(filter.keys), filter.thresholdPct) === filter.side
}
