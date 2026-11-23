import { describe, expect, it } from 'vitest'

import type { FieldFlag, MatchRecord } from '@/api'
import {
  isFieldFlagged,
  leftOutFields,
  leftOutPaths,
  openFlags,
  recordsWithoutSuspectFields,
  withoutSuspectFields,
} from '@/match/quality/field-flags'

function flag(field: string, state: FieldFlag['state'] = 'open'): FieldFlag {
  return { field, value: '', checks: ['plausible_range'], state, readings: [] }
}

function rec(flags: FieldFlag[], dataOver: Partial<MatchRecord['data']> = {}): MatchRecord {
  return {
    match_key: 'match-2026-06-07T23-00-04',
    source_files: ['summary.png', 'teams.png'],
    data: {
      map: 'rialto', result: 'victory', rank: 'gold', level: 3,
      rank_progress: 40, change_percent: 18, rank_percentile: 61,
      eliminations: 74, assists: 9, deaths: 6, damage: 7200, healing: 300, mitigation: 0,
      performance: {
        eliminations: { total: 74, avg_per_10min: 12.97 },
        assists: { total: 9, avg_per_10min: 13.1 },
        deaths: { total: 6, avg_per_10min: 8.7 },
      },
      heroes_played: [
        { hero: 'juno', percent_played: 80, play_time: '05:30', stats: { orbital_ray_assists: 3, torpedo_damage: 900 } },
        { hero: 'lucio', percent_played: 20, play_time: '01:26' },
      ],
      sr: [{ hero: 'juno', sr: 2450, change: 18 }, { hero: 'lucio', sr: 2300 }],
      ...dataOver,
    },
    ...(flags.length > 0 ? { field_flags: flags } : {}),
  }
}

describe('openFlags / isFieldFlagged', () => {
  it('counts only the flags still waiting on the user', () => {
    const r = rec([flag('data.damage'), flag('data.healing', 'confirmed'), flag('data.level', 'edited')])

    expect(openFlags(r).map((f) => f.field)).toEqual(['data.damage'])
    expect(isFieldFlagged(r, 'data.damage')).toBe(true)
    expect(isFieldFlagged(r, 'data.healing')).toBe(false)
    expect(isFieldFlagged(r, 'data.mitigation')).toBe(false)
  })

  it('reads a record with no flags as having none', () => {
    expect(openFlags(rec([]))).toEqual([])
  })
})

describe('withoutSuspectFields', () => {
  it('hands back the very same record when nothing is open', () => {
    const clean = rec([])
    const settled = rec([flag('data.eliminations', 'confirmed'), flag('data.damage', 'edited')])

    expect(withoutSuspectFields(clean)).toBe(clean)
    expect(withoutSuspectFields(settled)).toBe(settled)
  })

  it('leaves a flagged scalar out and keeps every other field', () => {
    const r = rec([flag('data.damage')])
    const out = withoutSuspectFields(r)

    expect(out.data.damage).toBeUndefined()
    expect(out.data.healing).toBe(300)
    expect(out.data.heroes_played).toBe(r.data.heroes_played)
    expect(out.field_flags).toEqual(r.field_flags)
  })

  it('never edits the record it was given', () => {
    const r = rec([flag('data.damage')])
    withoutSuspectFields(r)
    expect(r.data.damage).toBe(7200)
  })

  // Every ratio over E/A/D reads a missing member as 0, so leaving one out
  // alone would turn 74/9/6 into 0/9/6 — a worse number, not an absent one.
  it('leaves the whole combat line out when one of E/A/D is flagged', () => {
    const out = withoutSuspectFields(rec([flag('data.eliminations')]))

    expect(out.data.eliminations).toBeUndefined()
    expect(out.data.assists).toBeUndefined()
    expect(out.data.deaths).toBeUndefined()
    expect(out.data.performance).toBeUndefined()
    expect(out.data.damage).toBe(7200)
  })

  it.each(['data.result', 'data.level', 'data.rank_progress', 'data.change_percent', 'data.rank_percentile'])(
    'treats a flagged %s as unread',
    (field) => {
      const out = withoutSuspectFields(rec([flag(field)]))
      expect(out.data[field.slice('data.'.length) as keyof MatchRecord['data']]).toBeUndefined()
    },
  )

  it("drops a hero's flagged share without touching the other heroes", () => {
    const r = rec([flag('data.heroes_played.juno.percent_played')])
    const heroes = withoutSuspectFields(r).data.heroes_played ?? []

    expect(heroes.map((h) => h.hero)).toEqual(['juno', 'lucio'])
    expect(heroes[0]?.percent_played).toBeUndefined()
    expect(heroes[0]?.play_time).toBe('05:30')
    expect(heroes[1]).toBe(r.data.heroes_played?.[1])
  })

  it('drops one flagged hero stat and keeps its siblings', () => {
    const out = withoutSuspectFields(rec([flag('data.heroes_played.juno.stats.torpedo_damage')]))
    expect(out.data.heroes_played?.[0]?.stats).toEqual({ orbital_ray_assists: 3 })
  })

  // A rank card holds one measurement; a card with no SR is no card.
  it('drops the rank card whose SR is flagged', () => {
    const out = withoutSuspectFields(rec([flag('data.sr.juno.sr')]))
    expect(out.data.sr?.map((c) => c.hero)).toEqual(['lucio'])
  })

  // Which heroes a match had is what every other number on it is keyed by;
  // removing a hero would hand its time to whoever is left.
  it.each(['data.heroes_played', 'data.heroes_played.juno', 'data.sr.juno'])(
    'leaves the record whole for a flag on who was played (%s)',
    (field) => {
      const r = rec([flag(field)])
      expect(withoutSuspectFields(r)).toBe(r)
    },
  )

  it('leaves nothing out for a flag naming a field the record no longer holds', () => {
    const r = rec([flag('data.heroes_played.ana.percent_played'), flag('data.sr.ana.sr')])
    expect(withoutSuspectFields(r)).toBe(r)
  })
})

describe('leftOutFields', () => {
  it('names the open flags that keep a value out of the stats', () => {
    const r = rec([
      flag('data.eliminations'), flag('data.assists'), flag('data.heroes_played'),
      flag('data.damage', 'confirmed'),
    ])
    expect(leftOutFields(r).map((f) => f.field)).toEqual(['data.eliminations', 'data.assists'])
  })
})

// The detail shows the record as read, so it needs to know which of its
// values the stats leave out — and for whose flag — to mark every one.
describe('leftOutPaths', () => {
  it('names every value of a flagged combat line, each pointing at the flag', () => {
    const out = leftOutPaths(rec([flag('data.eliminations')]))

    expect(Object.fromEntries(out)).toEqual({
      'data.eliminations': 'data.eliminations',
      'data.assists': 'data.eliminations',
      'data.deaths': 'data.eliminations',
      'data.performance': 'data.eliminations',
    })
  })

  it('points a value at its own flag over a sibling it shares a line with', () => {
    const out = leftOutPaths(rec([flag('data.eliminations'), flag('data.assists')]))

    expect(out.get('data.assists')).toBe('data.assists')
    expect(out.get('data.deaths')).toBe('data.eliminations')
  })

  it('names only the flagged scalar when it stands alone', () => {
    expect(Object.fromEntries(leftOutPaths(rec([flag('data.damage')])))).toEqual({ 'data.damage': 'data.damage' })
  })

  it('names nothing for a settled flag, or one that leaves no value out', () => {
    expect(leftOutPaths(rec([flag('data.damage', 'confirmed'), flag('data.heroes_played')])).size).toBe(0)
  })
})

describe('recordsWithoutSuspectFields', () => {
  it('hands back the same list when no record has an open flag', () => {
    const list = [rec([]), rec([flag('data.damage', 'confirmed')])]
    expect(recordsWithoutSuspectFields(list)).toBe(list)
  })

  it('copies only the records it changes', () => {
    const clean = rec([])
    const list = [clean, rec([flag('data.damage')])]
    const out = recordsWithoutSuspectFields(list)

    expect(out).not.toBe(list)
    expect(out[0]).toBe(clean)
    expect(out[1]?.data.damage).toBeUndefined()
  })
})
