import { describe, expect, it } from 'vitest'
import { computed } from 'vue'

import type { MatchRecord } from '@/api-client'
import {
  NARROW_CLAUSES,
  type ClauseCtx,
  type ClauseId,
  type ClauseSpec,
} from '@/composables/matches/narrow/matchesNarrow.clauses'
import { createMatchesNarrowState } from '@/composables/matches/narrow/matchesNarrow.state'
import type { MatchesNarrowState, SourcePick } from '@/composables/matches/narrow/matchesNarrow.types'
import { PROVENANCE_OPTIONS } from '@/composables/matches/narrow/matchesNarrow.options'

// The narrow-clause REGISTRY contract. Every dimension declares its own
// predicate / restriction test / label / chip count / single-clause reset in
// ONE entry, and five different consumers (narrowedRecords, the cross-band
// "narrow minus self" sets, the active-chip count, the smart-empty
// suggestions, the per-clause clear) read them back generically. A map-shaped
// registry loses the compiler's exhaustiveness check that a `switch` would
// have given, so CASE_BY_ID below restores it: the `Record<ClauseId, …>`
// annotation makes a new ClauseId a TYPE error until it has a case, and the
// completeness test makes a registry entry that nobody declared a RUNTIME
// failure.

const ANCHOR_KEY = 'match-2026-05-10T12-00-00'
const ANCHOR_FLOOR = '2026-05-10T12:00:00Z'
const SEASON = 'Chapter 5: Season 18'
// Explicit UTC instants — a season window is an absolute span, so the fixture
// must not depend on the runner's zone.
const SEASON_WINDOW = {
  startMs: Date.parse('2026-05-01T00:00:00Z'),
  endMs:   Date.parse('2026-06-01T00:00:00Z'),
}

function makeState(): MatchesNarrowState {
  return createMatchesNarrowState({ anchorKey: computed(() => ANCHOR_KEY) })
}

function makeCtx(over: Partial<ClauseCtx> = {}): ClauseCtx {
  return {
    searchClauses: [],
    heroRole: (hero) => (hero === 'lucio' ? 'support' : 'dps'),
    anchorFloor: null,
    seasonWindow: (name) => (name === SEASON ? SEASON_WINDOW : null),
    skip: new Set<ClauseId>(),
    ...over,
  }
}

function rec(over: Partial<MatchRecord> = {}): MatchRecord {
  return { match_key: 'm', data: { map: 'rialto' }, ...over } as MatchRecord
}

const data = (d: Record<string, unknown>) => ({ data: d as MatchRecord['data'] })
const ann = (a: Record<string, unknown>) => ({ annotation: a as MatchRecord['annotation'] })

function spec(id: ClauseId): ClauseSpec {
  const found = NARROW_CLAUSES.find((c) => c.id === id)
  if (!found) throw new Error(`no clause registered for id "${id}"`)
  return found
}

interface ClauseCase {
  // Puts the clause — and only this clause — into a restricting state.
  arrange: (s: MatchesNarrowState) => void
  // A record the arranged clause keeps, and one it drops. `drops: null` is
  // reserved for minPlay, which deliberately has no independent row gate.
  keeps: MatchRecord
  drops: MatchRecord | null
  // The smart-empty suggestion chip's copy for the arranged state.
  label: string
  ctx?: Partial<ClauseCtx>
  // includeUnknown is the one clause whose DEFAULT state is the restricting
  // one (unknown-map rows are hidden until the user opts in).
  restrictsByDefault?: true
}

const CASE_BY_ID: Record<ClauseId, ClauseCase> = {
  includeUnknown: {
    restrictsByDefault: true,
    arrange: () => {},
    keeps: rec(),
    drops: rec(data({})),
    label: 'unknown-map exclusion',
  },
  search: {
    arrange: (s) => { s.searchText.value = '  clutch  ' },
    ctx: { searchClauses: [{ field: null, value: 'clutch' }] },
    keeps: rec(ann({ note: 'huge clutch hold' })),
    drops: rec(),
    label: 'search "clutch"',
  },
  dateRange: {
    arrange: (s) => {
      s.pickedRange.value = 'custom'
      s.customFrom.value = '2026-05-01'
      s.customTo.value = '2026-05-31'
    },
    keeps: rec(data({ date: '2026-05-10', finished_at: '14:00' })),
    drops: rec(data({ date: '2026-06-10', finished_at: '14:00' })),
    label: 'date range',
  },
  maps: {
    arrange: (s) => { s.pickedMaps.value = new Set(['rialto']) },
    keeps: rec(),
    drops: rec(data({ map: 'oasis' })),
    label: 'map rialto',
  },
  gameModes: {
    arrange: (s) => { s.pickedGameModes.value = new Set(['control']) },
    keeps: rec(data({ game_mode: 'control' })),
    drops: rec(data({ game_mode: 'escort' })),
    label: 'game-mode control',
  },
  roles: {
    arrange: (s) => { s.pickedRoles.value = new Set(['support']) },
    keeps: rec(data({ hero: 'lucio', heroes_played: [{ hero: 'lucio', percent_played: 100 }] })),
    drops: rec(data({ hero: 'ashe', heroes_played: [{ hero: 'ashe', percent_played: 100 }] })),
    label: 'role support',
  },
  results: {
    arrange: (s) => { s.pickedResults.value = new Set(['victory']) },
    keeps: rec(data({ result: 'victory' })),
    drops: rec(data({ result: 'defeat' })),
    label: 'result victory',
  },
  heroes: {
    arrange: (s) => { s.pickedHeroes.value = new Set(['lucio']) },
    keeps: rec(data({ hero: 'lucio' })),
    drops: rec(data({ hero: 'mercy' })),
    label: 'hero lucio',
  },
  minPlay: {
    arrange: (s) => {
      s.pickedHeroes.value = new Set(['lucio'])
      s.minPlayMinutes.value = 5
    },
    keeps: rec(),
    drops: null,
    label: 'minimum play threshold',
  },
  tags: {
    arrange: (s) => { s.pickedTags.value = new Set(['scrim']) },
    keeps: rec(ann({ tags: ['scrim'] })),
    drops: rec(ann({ tags: ['solo'] })),
    label: 'tag #scrim',
  },
  members: {
    arrange: (s) => { s.pickedMembers.value = new Set(['Alice']) },
    keeps: rec(ann({ members: ['Alice'] })),
    drops: rec(ann({ members: ['Bob'] })),
    label: 'with Alice',
  },
  reviewedBy: {
    arrange: (s) => { s.pickedReviewedBy.value = new Set(['coach']) },
    keeps: rec({ reviewed_by: 'coach' } as Partial<MatchRecord>),
    drops: rec({ reviewed_by: 'self' } as Partial<MatchRecord>),
    label: 'reviewed-by filter',
  },
  queues: {
    arrange: (s) => { s.pickedQueues.value = new Set(['role']) },
    keeps: rec({ queue_type: 'role' } as Partial<MatchRecord>),
    drops: rec({ queue_type: 'open' } as Partial<MatchRecord>),
    label: 'queue-type filter',
  },
  playModes: {
    arrange: (s) => { s.pickedPlayModes.value = new Set(['competitive']) },
    keeps: rec({ play_mode: 'competitive' } as Partial<MatchRecord>),
    drops: rec({ play_mode: 'quickplay' } as Partial<MatchRecord>),
    label: 'play-mode filter',
  },
  sources: {
    arrange: (s) => { s.pickedSources.value = new Set(['manual']) },
    keeps: rec({ source: 'manual' } as Partial<MatchRecord>),
    drops: rec(),
    label: 'user-entered only',
  },
  sinceAnchor: {
    arrange: (s) => { s.sinceAnchorActive.value = true },
    ctx: { anchorFloor: ANCHOR_FLOOR },
    keeps: rec({ parsed_at: '2026-05-11T00:00:00Z' } as Partial<MatchRecord>),
    drops: rec({ parsed_at: '2026-05-09T00:00:00Z' } as Partial<MatchRecord>),
    label: 'since-anchor floor',
  },
  season: {
    arrange: (s) => { s.pickedSeason.value = SEASON },
    keeps: rec(data({ played_at_utc: '2026-05-10T12:00:00Z' })),
    drops: rec(data({ played_at_utc: '2026-07-10T12:00:00Z' })),
    label: `season ${SEASON}`,
  },
  leaver: {
    arrange: (s) => { s.leaverHandling.value = 'hide' },
    keeps: rec(),
    drops: rec(ann({ leavers: ['team'] })),
    label: 'leaver handling',
  },
  leaverSide: {
    arrange: (s) => { s.pickedLeavers.value = new Set(['team']) },
    keeps: rec(ann({ leavers: ['team'] })),
    drops: rec(ann({ leavers: ['enemy'] })),
    label: 'team leaver',
  },
  throwerSide: {
    arrange: (s) => { s.pickedThrowers.value = new Set(['enemy']) },
    keeps: rec(ann({ throwers: ['enemy'] })),
    drops: rec(ann({ throwers: ['team'] })),
    label: 'enemy thrower',
  },
  modifiers: {
    arrange: (s) => { s.pickedModifiers.value = new Set(['reversal']) },
    keeps: rec(data({ modifiers: ['reversal'] })),
    drops: rec(data({ modifiers: ['expected'] })),
    label: 'modifier reversal',
  },
  ranks: {
    arrange: (s) => { s.pickedRanks.value = new Set(['gold']) },
    keeps: rec(data({ rank: 'gold' })),
    drops: rec(data({ rank: 'silver' })),
    label: 'rank gold',
  },
  poolSide: {
    arrange: (s) => { s.poolFilter.value = { side: 'pure', keys: ['lucio'], thresholdPct: 5 } },
    keeps: rec(data({ heroes_played: [{ hero: 'lucio', percent_played: 100 }] })),
    drops: rec(data({ heroes_played: [{ hero: 'mercy', percent_played: 100 }] })),
    label: 'on-pool games',
  },
  reviewSet: {
    arrange: (s) => { s.reviewSetFilter.value = { keys: new Set(['kept-key']), label: 'notes from Ordo' } },
    keeps: { ...rec(data({})), match_key: 'kept-key' },
    drops: { ...rec(data({})), match_key: 'dropped-key' },
    label: 'notes from Ordo',
  },
}

const ALL_IDS = Object.keys(CASE_BY_ID) as ClauseId[]

function restrictingIds(s: MatchesNarrowState): ClauseId[] {
  return NARROW_CLAUSES.filter((c) => c.restricts(s)).map((c) => c.id)
}

describe('NARROW_CLAUSES registry', () => {
  it('declares every ClauseId exactly once, and nothing else', () => {
    const ids = NARROW_CLAUSES.map((c) => c.id)
    expect([...ids].sort()).toEqual([...ALL_IDS].sort())
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('restricts nothing but the unknown-map exclusion on a fresh state', () => {
    expect(restrictingIds(makeState())).toEqual(['includeUnknown'])
  })

  it('keeps every record on a fresh state except the unknown-map row', () => {
    const s = makeState()
    const ctx = makeCtx()
    const unknownMap = rec(data({}))
    for (const c of NARROW_CLAUSES) {
      expect(c.passes(rec(), s, ctx), `${c.id} dropped a default record`).toBe(true)
      expect(c.passes(unknownMap, s, ctx), `${c.id} on an unknown-map row`)
        .toBe(c.id !== 'includeUnknown')
    }
  })
})

describe.each(ALL_IDS)('clause %s', (id) => {
  const c = CASE_BY_ID[id]
  const clause = spec(id)

  it('restricts only once arranged, and stops after clear()', () => {
    const s = makeState()
    expect(clause.restricts(s)).toBe(c.restrictsByDefault ?? false)
    c.arrange(s)
    expect(clause.restricts(s)).toBe(true)
    clause.clear(s)
    expect(clause.restricts(s)).toBe(false)
  })

  it('keeps the matching record and drops the non-matching one', () => {
    const s = makeState()
    c.arrange(s)
    const ctx = makeCtx(c.ctx)
    expect(clause.passes(c.keeps, s, ctx)).toBe(true)
    if (c.drops) expect(clause.passes(c.drops, s, ctx)).toBe(false)
  })

  it('labels the arranged restriction for the smart-empty chip', () => {
    const s = makeState()
    c.arrange(s)
    expect(clause.label(s)).toBe(c.label)
  })
})

describe('clear() isolation', () => {
  // Every clause arranged at once, then one lifted: the lifted clause must be
  // the ONLY one that stops restricting. A clear() that reached into a
  // neighbor's state (or reset the whole bundle) shows up here.
  // minPlay is the one documented coupling — the thresholds qualify the hero
  // picks and are inert without them, so lifting `heroes` lifts it too.
  const coupled: Partial<Record<ClauseId, ClauseId>> = { heroes: 'minPlay' }

  it.each(ALL_IDS)('lifting %s leaves every other clause restricting', (id) => {
    const s = makeState()
    for (const other of ALL_IDS) CASE_BY_ID[other].arrange(s)
    expect(restrictingIds(s).sort()).toEqual([...ALL_IDS].sort())

    spec(id).clear(s)
    const lifted = [id, coupled[id]].filter(Boolean)
    expect(restrictingIds(s).sort()).toEqual(ALL_IDS.filter((x) => !lifted.includes(x)).sort())
  })
})

describe('chip counting', () => {
  // The clauses WITHOUT their own `chips` fall back to the ClauseSpec default
  // (restricts ? 1 : 0) — pinned as a list so a clause that silently grows or
  // loses a per-pick count is visible in the diff.
  it('only the single-toggle clauses use the default chip count', () => {
    const single = NARROW_CLAUSES.filter((c) => !c.chips).map((c) => c.id)
    expect(single.sort()).toEqual(['dateRange', 'leaver', 'poolSide', 'reviewSet', 'search', 'season', 'sinceAnchor'])
  })

  it('a picked-set clause counts one chip PER pick, not one for the clause', () => {
    const s = makeState()
    s.pickedMaps.value = new Set(['rialto', 'oasis', 'numbani'])
    expect(spec('maps').chips?.(s)).toBe(3)
  })

  it('minPlay counts each threshold separately', () => {
    const s = makeState()
    const chips = () => spec('minPlay').chips?.(s)
    expect(chips()).toBe(0)
    s.minPlayMinutes.value = 5
    expect(chips()).toBe(1)
    s.minPlayPercent.value = 40
    expect(chips()).toBe(2)
  })

  it('includeUnknown counts its non-default ON state, which is when it stops restricting', () => {
    const s = makeState()
    const clause = spec('includeUnknown')
    // Default: hiding unknown-map rows IS the restriction, and it costs no chip.
    expect(clause.restricts(s)).toBe(true)
    expect(clause.chips?.(s)).toBe(0)
    // clear() means "lift the exclusion" — it sets true, NOT the default false.
    clause.clear(s)
    expect(s.includeUnknown.value).toBe(true)
    expect(clause.restricts(s)).toBe(false)
    expect(clause.chips?.(s)).toBe(1)
  })
})

describe('label edge cases', () => {
  it('a picked-set names its single pick but counts several', () => {
    const s = makeState()
    const label = () => spec('tags').label(s)
    s.pickedTags.value = new Set(['scrim'])
    expect(label()).toBe('tag #scrim')
    s.pickedTags.value = new Set(['scrim', 'solo'])
    expect(label()).toBe('2 tag picks')
  })

  it('provenance names the single bucket it isolates, else reads generically', () => {
    const s = makeState()
    const label = () => spec('sources').label(s)
    s.pickedSources.value = new Set(['manual'])
    expect(label()).toBe('user-entered only')
    s.pickedSources.value = new Set(['ocr_edited'])
    expect(label()).toBe('edited only')
    s.pickedSources.value = new Set(['replay'])
    expect(label()).toBe('replay-review only')
    s.pickedSources.value = new Set(['manual', 'ocr_edited'])
    expect(label()).toBe('provenance filter')
  })

  // The label used to be a two-way ternary, so a third bucket would have
  // silently read as "edited only". Every chip the panel offers has to name
  // itself, and this is the test that says so rather than trusting the next
  // person to notice.
  it('every provenance chip names itself when it is the only one picked', () => {
    const s = makeState()
    for (const opt of PROVENANCE_OPTIONS) {
      s.pickedSources.value = new Set([opt.value as SourcePick])
      expect(spec('sources').label(s)).not.toBe('provenance filter')
    }
  })

  it('the pool clause names the side it kept', () => {
    const s = makeState()
    s.poolFilter.value = { side: 'off', keys: ['lucio'], thresholdPct: 5 }
    expect(spec('poolSide').label(s)).toBe('off-pool games')
  })
})

describe('minPlay ⇢ heroes coupling', () => {
  const belowThreshold = rec(data({
    hero: 'lucio',
    heroes_played: [{ hero: 'lucio', percent_played: 20, play_time: '2:00' }],
  }))

  function arrangeHeroWithThreshold(): MatchesNarrowState {
    const s = makeState()
    s.pickedHeroes.value = new Set(['lucio'])
    s.minPlayMinutes.value = 5
    return s
  }

  it('a threshold disqualifies a hero the record barely played', () => {
    const s = arrangeHeroWithThreshold()
    expect(spec('heroes').passes(belowThreshold, s, makeCtx())).toBe(false)
  })

  it('skipping minPlay zeroes the thresholds but KEEPS the hero picks', () => {
    const s = arrangeHeroWithThreshold()
    const skipped = makeCtx({ skip: new Set<ClauseId>(['minPlay']) })
    expect(spec('heroes').passes(belowThreshold, s, skipped)).toBe(true)
    // The picks survive the skip — a record on another hero still drops, so
    // the "remove the min-play threshold" suggestion can't over-promise.
    expect(spec('heroes').passes(rec(data({ hero: 'ana' })), s, skipped)).toBe(false)
  })

  it('a threshold with no hero picks restricts nothing, so it is not suggestible', () => {
    const s = makeState()
    s.minPlayMinutes.value = 5
    expect(spec('minPlay').restricts(s)).toBe(false)
  })
})

describe('sinceAnchor two-leg guard', () => {
  it('an active toggle pointing at no anchor is a no-op, not a clause', () => {
    const noAnchor = createMatchesNarrowState({ anchorKey: computed(() => '') })
    noAnchor.sinceAnchorActive.value = true
    expect(spec('sinceAnchor').restricts(noAnchor)).toBe(false)
  })

  it('a null floor keeps every record, whatever the toggle says', () => {
    const s = makeState()
    s.sinceAnchorActive.value = true
    const old = rec({ parsed_at: '2020-01-01T00:00:00Z' } as Partial<MatchRecord>)
    expect(spec('sinceAnchor').passes(old, s, makeCtx())).toBe(true)
  })
})
