import { describe, expect, it } from 'vitest'

import type { MatchRecord } from '@/api-client'
import { toRecapInput, buildSeasonRecap } from '@/match/recap/season-recap'
import type { Season } from '@/composables/shared/useOWData'

// The season recap: one self-contained page a player can keep.
//
// Two things are held here rather than trusted. The AGGREGATION must count the
// season it says it is counting — a recap that quietly included last season is
// worse than none. And the PAGE must open with the network off, forever: no
// scripts, no images, no links, no fonts, nothing that reaches out, and every
// interpolation escaped.

const SEASON: Season = {
  name: 'Reign of Talon — Season 4',
  chapter: 'Reign of Talon',
  number: 4,
  start: '2026-08-11T19:00:00Z',
  end: '2026-10-13T19:00:00Z',
}

const PREVIOUS: Season = { ...SEASON, name: 'Reign of Talon — Season 3', number: 3, start: '2026-06-16T19:00:00Z', end: '2026-08-11T19:00:00Z' }

interface Bits {
  utc: string
  result?: string
  hero?: string
  map?: string
  rank?: { tier: string; level: number; progress?: number }
}

let seq = 0
function rec({ utc, result = 'victory', hero = 'lucio', map = 'rialto', rank }: Bits): MatchRecord {
  seq++
  return {
    match_key: `m${seq}`,
    queue_type: 'role',
    data: {
      playlist: 'competitive', map, hero, role: 'support', result,
      date: utc.slice(0, 10), finished_at: utc.slice(11, 16),
      played_at_utc: utc, game_length: '14:00',
      heroes_played: [{ hero, percent_played: 100, play_time: '14:00' }],
      ...(rank ? { rank: rank.tier, level: rank.level, rank_progress: rank.progress } : {}),
    },
  } as unknown as MatchRecord
}

function corpus(): MatchRecord[] {
  seq = 0
  return [
    // Last season — must not be counted.
    rec({ utc: '2026-07-01T20:00:00Z', result: 'defeat', hero: 'ana' }),
    rec({ utc: '2026-08-12T20:00:00Z', rank: { tier: 'gold', level: 3, progress: 20 } }),
    rec({ utc: '2026-08-13T20:00:00Z', result: 'defeat', map: 'ilios' }),
    rec({ utc: '2026-08-14T20:00:00Z', hero: 'ana' }),
    rec({ utc: '2026-08-15T20:00:00Z', result: 'draw' }),
    rec({ utc: '2026-09-01T20:00:00Z', rank: { tier: 'platinum', level: 5, progress: 40 } }),
  ]
}

describe('toRecapInput', () => {
  it('counts only the season it says it is counting', () => {
    const got = toRecapInput(corpus(), SEASON)
    expect(got.season).toBe(SEASON.name)
    // Five in season 4; the July match belongs to season 3.
    expect(got.games).toBe(5)
    expect(got.wins).toBe(3)
    expect(got.losses).toBe(1)
    expect(got.draws).toBe(1)
    expect(got.winratePct).toBe(75)
  })

  it('reports where the season started and where it ended', () => {
    const got = toRecapInput(corpus(), SEASON)
    expect(got.rankStart).toBe('Gold 3')
    expect(got.rankEnd).toBe('Platinum 5')
  })

  it('says the rank is unknown rather than inventing one', () => {
    seq = 0
    const got = toRecapInput([rec({ utc: '2026-08-12T20:00:00Z' })], SEASON)
    // A season with no rank capture has an unknown start, not Bronze 5.
    expect(got.rankStart).toBeNull()
    expect(got.rankEnd).toBeNull()
  })

  it('has no win rate over a season with no decisive games', () => {
    seq = 0
    const got = toRecapInput([rec({ utc: '2026-08-12T20:00:00Z', result: 'draw' })], SEASON)
    expect(got.winratePct).toBeNull()
    expect(got.games).toBe(1)
  })

  it('counts the previous season as its own, not as a slice of this one', () => {
    const got = toRecapInput(corpus(), PREVIOUS)
    expect(got.games).toBe(1)
    expect(got.topHeroes).toEqual([{ key: 'ana', games: 1, winratePct: 0 }])
  })

  it('ranks the heroes by games played, best win rate breaking a tie', () => {
    const got = toRecapInput(corpus(), SEASON)
    expect(got.topHeroes[0]?.key).toBe('lucio')
    expect(got.topHeroes.map((h) => h.key)).toContain('ana')
  })
})

describe('buildSeasonRecap', () => {
  const page = () => buildSeasonRecap(toRecapInput(corpus(), SEASON), '.x{color:red}')

  it('reaches out for nothing — it has to open with the network off, forever', () => {
    const html = page()
    // The same list the coach sheet's twin carries. Escaping is the ONLY
    // defense in a page built by string concatenation, and this is what holds
    // it: a shorter list is a weaker guard, not a tidier one.
    for (const forbidden of [
      '<script', '<img', '<iframe', '<link', '<a ', 'href=', 'src=', 'srcset=',
      'http://', 'https://', '@import', 'url(', 'javascript:',
    ]) {
      expect(html, `recap contains ${forbidden}`).not.toContain(forbidden)
    }
    expect(html).not.toMatch(/\son\w+\s*=/)
    expect(html).toContain("default-src 'none'")
  })

  it('neutralizes text that tries to reach out', () => {
    // The other half. A hero name is OCR output and a season name arrives
    // from a published YAML — neither is this app's to trust.
    seq = 0
    const hostile = toRecapInput(
      [rec({ utc: '2026-08-12T20:00:00Z', hero: '<img src=x onerror=alert(1)>' })],
      { ...SEASON, name: '<a href="javascript:alert(2)">S4</a>' },
    )
    const html = buildSeasonRecap(hostile, '')

    // No live tag survives. That is the whole proof: an inline handler can
    // only fire from inside a tag, and no `<` in the data becomes one.
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<a ')
    expect(html).toContain('&lt;img')
    // NOT asserting on the bare `href=` characters: they survive escaping as
    // inert text, so their absence would say nothing. The tags are the proof —
    // an inline handler can only fire from inside one.
  })

  it('carries the app\'s own stylesheet rather than a hand-copied subset', () => {
    expect(page()).toContain('.x{color:red}')
  })

  it('escapes every interpolation', () => {
    seq = 0
    const nasty = toRecapInput(
      [rec({ utc: '2026-08-12T20:00:00Z', hero: '<script>alert(1)</script>' })],
      { ...SEASON, name: 'S4 <b>&</b>' },
    )
    const html = buildSeasonRecap(nasty, '')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('S4 &lt;b&gt;&amp;&lt;/b&gt;')
  })

  it('names the season in the title, so a saved file is findable', () => {
    expect(page()).toContain('<title>Reign of Talon — Season 4 — season recap</title>')
  })

  it('says a season went unplayed instead of printing a wall of zeros', () => {
    const html = buildSeasonRecap(toRecapInput([], SEASON), '')
    expect(html).toContain('No competitive games this season')
    // The zeros the sentence replaces. Asserting on '0%' alone said nothing:
    // a season with no games has no win rate either, so the wall of zeros it
    // would print contains no percentage at all.
    expect(html).not.toContain('Games')
    expect(html).not.toContain('Longest win streak')
  })

  it('counts a day per match placed, not per match that carried a date', () => {
    // A season whose captures were all RANK screens carries no `date` field
    // at all. Counting days off it printed "5 games, 0 days played" — and
    // ordering by the naive clock dropped the match from the count entirely,
    // in a season the UTC filter had just accepted it into.
    seq = 0
    const dateless = {
      match_key: 'match:2026-08-20T20-00-00',
      data: { played_at_utc: '2026-08-20T20:00:00Z', result: 'victory' },
    } as unknown as MatchRecord
    const got = toRecapInput([dateless], SEASON)
    expect(got.games).toBe(1)
    expect(got.daysPlayed).toBe(1)
  })
})
