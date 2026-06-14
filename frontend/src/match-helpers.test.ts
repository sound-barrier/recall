import { describe, it, expect } from 'vitest'
import {
  SCREENSHOT_TYPES,
  sshotTypeLabel,
  sourceType,
  detectScreenshotSlots,
  missingRequiredSlots,
  missingOptionalSlots,
  heroesForHeader,
  rolesForHeader,
  formatHeroes,
  formatRoles,
  formatRowDate,
  formatFinishedAt,
  screenshotURL,
  highlightSubstring,
} from '@/match-helpers'

// ─── sshotTypeLabel ──────────────────────────────────────────────────

describe('sshotTypeLabel', () => {
  it('maps scoreboard → TEAMS (the UI label everywhere else)', () => {
    expect(sshotTypeLabel('teams')).toBe('TEAMS')
  })

  it('upper-cases the rest', () => {
    expect(sshotTypeLabel('summary')).toBe('SUMMARY')
    expect(sshotTypeLabel('personal')).toBe('PERSONAL')
    expect(sshotTypeLabel('rank')).toBe('RANK')
  })

  it('returns UNKNOWN for empty / nullish input', () => {
    expect(sshotTypeLabel('')).toBe('UNKNOWN')
    expect(sshotTypeLabel(undefined)).toBe('UNKNOWN')
    expect(sshotTypeLabel(null)).toBe('UNKNOWN')
  })
})

// ─── sourceType ──────────────────────────────────────────────────────

describe('sourceType', () => {
  it('returns the type from source_types map', () => {
    const rec = { source_types: { 'a.png': 'summary' as const, 'b.png': 'rank' as const } }
    expect(sourceType(rec, 'a.png')).toBe('summary')
    expect(sourceType(rec, 'b.png')).toBe('rank')
  })

  it('returns "" when the file is not in the map', () => {
    expect(sourceType({ source_types: { 'a.png': 'summary' as const } }, 'b.png')).toBe('')
  })

  it('returns "" for pre-migration records (no source_types field)', () => {
    expect(sourceType({}, 'a.png')).toBe('')
  })

  it('handles null/undefined record safely', () => {
    expect(sourceType(null, 'a.png')).toBe('')
    expect(sourceType(undefined, 'a.png')).toBe('')
  })
})

// ─── detectScreenshotSlots ───────────────────────────────────────────

describe('detectScreenshotSlots', () => {
  it('returns four slots in workflow order', () => {
    const slots = detectScreenshotSlots({ data: {} })
    expect(slots.map(s => s.key)).toEqual(SCREENSHOT_TYPES)
  })

  it('marks only RANK as optional', () => {
    const slots = detectScreenshotSlots({ data: {} })
    expect(slots.filter(s => s.required).map(s => s.key)).toEqual(['summary', 'teams', 'personal'])
    expect(slots.filter(s => !s.required).map(s => s.key)).toEqual(['rank'])
  })

  describe('with stored source_types (authoritative)', () => {
    it('marks only the present types — scoreboard + rank', () => {
      const rec = {
        source_types: { 'a.png': 'teams' as const, 'b.png': 'rank' as const },
        data: { eliminations: 17 },
      }
      const present = detectScreenshotSlots(rec).filter(s => s.present).map(s => s.key)
      expect(present).toEqual(['teams', 'rank'])
    })

    it('ignores field-inference fallback when source_types is set', () => {
      // d.result is populated (e.g. inferred from SR change) but source_types
      // does NOT include "summary" — SUMMARY chip must stay absent.
      const rec = {
        source_types: { 'a.png': 'rank' as const },
        data: { result: 'victory' as const, rank: 'platinum' },
      }
      const slots = detectScreenshotSlots(rec)
      expect(slots.find(s => s.key === 'summary')!.present).toBe(false)
      expect(slots.find(s => s.key === 'rank')!.present).toBe(true)
    })

    it('all 4 present when all 4 types stored', () => {
      const rec = {
        source_types: {
          'a.png': 'summary' as const,
          'b.png': 'teams' as const,
          'c.png': 'personal' as const,
          'd.png': 'rank' as const,
        },
        data: {},
      }
      expect(detectScreenshotSlots(rec).every(s => s.present)).toBe(true)
    })
  })

  describe('without source_types', () => {
    // source_types is populated at parse time, so a record without it
    // can only come from a hand-built fixture or a defensive-null
    // path. Every chip falls to absent.
    it('every slot reports absent', () => {
      const rec = { data: { eliminations: 17, deaths: 11, final_score: '3-1', rank: 'platinum' } }
      expect(detectScreenshotSlots(rec).every(s => !s.present)).toBe(true)
    })
  })
})

// ─── missingRequiredSlots / missingOptionalSlots ─────────────────────

describe('missingRequiredSlots / missingOptionalSlots', () => {
  it('Suravasa-style: PERSONAL + RANK only → SUMMARY+TEAMS missing required, none optional', () => {
    const rec = {
      source_types: { 'a.png': 'personal' as const, 'b.png': 'rank' as const },
      data: {},
    }
    const reqMissing = missingRequiredSlots(rec).map(s => s.key)
    const optMissing = missingOptionalSlots(rec).map(s => s.key)
    expect(reqMissing).toEqual(['summary', 'teams'])
    expect(optMissing).toEqual([])
  })

  it('complete match → no missing slots in either category', () => {
    const rec = {
      source_types: {
        'a.png': 'summary' as const,
        'b.png': 'teams' as const,
        'c.png': 'personal' as const,
        'd.png': 'rank' as const,
      },
      data: {},
    }
    expect(missingRequiredSlots(rec)).toEqual([])
    expect(missingOptionalSlots(rec)).toEqual([])
  })

  it('SUMMARY+TEAMS+PERSONAL but no RANK → only RANK in optional bucket', () => {
    const rec = {
      source_types: {
        'a.png': 'summary' as const,
        'b.png': 'teams' as const,
        'c.png': 'personal' as const,
      },
      data: {},
    }
    expect(missingRequiredSlots(rec)).toEqual([])
    expect(missingOptionalSlots(rec).map(s => s.key)).toEqual(['rank'])
  })
})

// ─── heroesForHeader ─────────────────────────────────────────────────

describe('heroesForHeader', () => {
  it('returns the heroes_played list sorted by percent_played desc', () => {
    const rec = {
      data: {
        heroes_played: [
          { hero: 'kiriko', percent_played: 30 },
          { hero: 'lucio',  percent_played: 60 },
          { hero: 'ana',    percent_played: 10 },
        ],
      },
    }
    expect(heroesForHeader(rec).map(h => h.hero)).toEqual(['lucio', 'kiriko', 'ana'])
  })

  it('falls back to the primary hero when heroes_played is empty', () => {
    const rec = { data: { hero: 'lucio' } }
    expect(heroesForHeader(rec)).toEqual([{ hero: 'lucio', percent_played: 0 }])
  })

  it('returns [] when neither hero nor heroes_played is set', () => {
    expect(heroesForHeader({ data: {} })).toEqual([])
  })

  it('does not mutate the source array', () => {
    const list = [
      { hero: 'kiriko', percent_played: 30 },
      { hero: 'lucio',  percent_played: 60 },
    ]
    heroesForHeader({ data: { heroes_played: list } })
    expect(list.map(h => h.hero)).toEqual(['kiriko', 'lucio']) // unchanged
  })
})

// ─── rolesForHeader ──────────────────────────────────────────────────

describe('rolesForHeader', () => {
  // Minimal heroRole stub keyed on the literal name. Mirrors the
  // useOWData().heroRole shape — anything unrecognised resolves to ''.
  const ROLE: Record<string, string> = {
    lucio: 'support', ana: 'support', mercy: 'support',
    kiriko: 'support', baptiste: 'support', zenyatta: 'support',
    zarya: 'tank', reinhardt: 'tank', winston: 'tank',
    hazard: 'tank', dva: 'tank', orisa: 'tank',
    reaper: 'dps', tracer: 'dps', soldier: 'dps',
  }
  const heroRole = (h: string | null | undefined) => h ? ROLE[h] ?? '' : ''

  it('dedupes single-role open queue (all 3 heroes support → ["support"])', () => {
    const rec = {
      data: {
        heroes_played: [
          { hero: 'lucio',  percent_played: 50 },
          { hero: 'mercy',  percent_played: 30 },
          { hero: 'ana',    percent_played: 20 },
        ],
      },
    }
    expect(rolesForHeader(rec, heroRole)).toEqual(['support'])
  })

  it('preserves first-appearance order (lucio, mercy, dva → ["support", "tank"])', () => {
    const rec = {
      data: {
        heroes_played: [
          { hero: 'lucio', percent_played: 50 },
          { hero: 'mercy', percent_played: 30 },
          { hero: 'dva',   percent_played: 20 },
        ],
      },
    }
    expect(rolesForHeader(rec, heroRole)).toEqual(['support', 'tank'])
  })

  it('preserves first-appearance order (hazard, winston, zenyatta → ["tank", "support"])', () => {
    const rec = {
      data: {
        heroes_played: [
          { hero: 'hazard',   percent_played: 50 },
          { hero: 'winston',  percent_played: 30 },
          { hero: 'zenyatta', percent_played: 20 },
        ],
      },
    }
    expect(rolesForHeader(rec, heroRole)).toEqual(['tank', 'support'])
  })

  it('lists every role for a full-spread open-queue match (lucio, zarya, reaper)', () => {
    const rec = {
      data: {
        heroes_played: [
          { hero: 'lucio',  percent_played: 40 },
          { hero: 'zarya',  percent_played: 35 },
          { hero: 'reaper', percent_played: 25 },
        ],
      },
    }
    expect(rolesForHeader(rec, heroRole)).toEqual(['support', 'tank', 'dps'])
  })

  it('walks heroes in percent-played order (heroesForHeader contract) not array order', () => {
    // Stored array is ana, dva, reaper but percent puts reaper at the
    // top, dva second, ana last. Expected role order: dps, tank, support.
    const rec = {
      data: {
        heroes_played: [
          { hero: 'ana',    percent_played: 10 },
          { hero: 'dva',    percent_played: 30 },
          { hero: 'reaper', percent_played: 60 },
        ],
      },
    }
    expect(rolesForHeader(rec, heroRole)).toEqual(['dps', 'tank', 'support'])
  })

  it('falls back to data.role when heroes_played is empty', () => {
    const rec = { data: { hero: 'lucio', role: 'support' as const } }
    expect(rolesForHeader(rec, heroRole)).toEqual(['support'])
  })

  it('drops hero entries whose role cannot be resolved (OCR mangle)', () => {
    const rec = {
      data: {
        heroes_played: [
          { hero: 'lucio',         percent_played: 50 },
          { hero: 'garbled-name',  percent_played: 30 },
          { hero: 'reaper',        percent_played: 20 },
        ],
      },
    }
    expect(rolesForHeader(rec, heroRole)).toEqual(['support', 'dps'])
  })

  it('returns [] when no heroes resolve and there is no data.role', () => {
    const rec = { data: { heroes_played: [{ hero: 'garbled', percent_played: 50 }] } }
    expect(rolesForHeader(rec, heroRole)).toEqual([])
  })
})

// ─── screenshotURL ───────────────────────────────────────────────────

describe('screenshotURL', () => {
  it('defaults dir-id to 0 when omitted (configured-dir fallback path)', () => {
    expect(screenshotURL('foo.png')).toBe('/_screenshot/0/foo.png')
  })

  it('embeds a positive dir-id in the URL', () => {
    expect(screenshotURL('foo.png', 7)).toBe('/_screenshot/7/foo.png')
  })

  it('percent-encodes spaces in the filename segment', () => {
    expect(screenshotURL('my file.png', 3)).toBe('/_screenshot/3/my%20file.png')
  })

  it('encodes & and = (common in OW screenshot naming)', () => {
    expect(screenshotURL('a&b=c.png', 1)).toBe('/_screenshot/1/a%26b%3Dc.png')
  })
})

// ─── highlightSubstring ─────────────────────────────────────────────

describe('highlightSubstring', () => {
  it('returns an empty array for empty text', () => {
    expect(highlightSubstring('', 'anything')).toEqual([])
    expect(highlightSubstring('', '')).toEqual([])
  })

  it('returns a single non-hit segment when the query is empty / whitespace', () => {
    expect(highlightSubstring('huge clutch', '')).toEqual([{ text: 'huge clutch', hit: false }])
    expect(highlightSubstring('huge clutch', '   ')).toEqual([{ text: 'huge clutch', hit: false }])
  })

  it('returns a single non-hit segment when the query does not match', () => {
    expect(highlightSubstring('huge clutch', 'win')).toEqual([
      { text: 'huge clutch', hit: false },
    ])
  })

  it('splits around a single mid-string hit', () => {
    expect(highlightSubstring('huge clutch finish', 'clutch')).toEqual([
      { text: 'huge ', hit: false },
      { text: 'clutch', hit: true },
      { text: ' finish', hit: false },
    ])
  })

  it('preserves original casing in the hit segment (case-insensitive match)', () => {
    expect(highlightSubstring('huge CLUTCH finish', 'clutch')).toEqual([
      { text: 'huge ', hit: false },
      { text: 'CLUTCH', hit: true },
      { text: ' finish', hit: false },
    ])
  })

  it('emits alternating segments for repeated matches', () => {
    expect(highlightSubstring('win win win', 'win')).toEqual([
      { text: 'win', hit: true },
      { text: ' ', hit: false },
      { text: 'win', hit: true },
      { text: ' ', hit: false },
      { text: 'win', hit: true },
    ])
  })

  it('handles a hit at the very start with no leading non-hit segment', () => {
    expect(highlightSubstring('clutch finish', 'clutch')).toEqual([
      { text: 'clutch', hit: true },
      { text: ' finish', hit: false },
    ])
  })

  it('handles a hit at the very end with no trailing non-hit segment', () => {
    expect(highlightSubstring('huge clutch', 'clutch')).toEqual([
      { text: 'huge ', hit: false },
      { text: 'clutch', hit: true },
    ])
  })

  it('treats the query as a plain substring, not a regex', () => {
    expect(highlightSubstring('the (clutch) finish', '(clutch)')).toEqual([
      { text: 'the ', hit: false },
      { text: '(clutch)', hit: true },
      { text: ' finish', hit: false },
    ])
  })

  it('trims surrounding whitespace from the query before matching', () => {
    expect(highlightSubstring('huge clutch', '  clutch  ')).toEqual([
      { text: 'huge ', hit: false },
      { text: 'clutch', hit: true },
    ])
  })
})

// ─── row formatters (formatHeroes / formatRoles / formatRowDate / formatFinishedAt) ──

describe('row formatters', () => {
  it('formatHeroes lists most-played first and appends a missing primary', () => {
    expect(formatHeroes({ data: { heroes_played: [
      { hero: 'ana', percent_played: 60 }, { hero: 'lucio', percent_played: 40 },
    ] } })).toBe('ana, lucio')
    // primary absent from a non-empty heroes_played → appended last
    expect(formatHeroes({ data: {
      hero: 'kiriko', heroes_played: [{ hero: 'ana', percent_played: 60 }],
    } })).toBe('ana, kiriko')
    expect(formatHeroes({ data: {} })).toBe('—')
  })

  it('formatRoles dedups roles in play-order via the heroRole lookup', () => {
    const heroRole = (h: string | null | undefined) =>
      ({ ana: 'support', lucio: 'support', dva: 'tank' })[h ?? ''] ?? ''
    expect(formatRoles({ data: { heroes_played: [
      { hero: 'lucio', percent_played: 50 },
      { hero: 'dva', percent_played: 30 },
      { hero: 'ana', percent_played: 20 },
    ] } }, heroRole)).toBe('support, tank')
    expect(formatRoles({ data: {} }, heroRole)).toBe('')
  })

  it('formatRowDate is short "Mon D", dash when undated, raw when unparseable', () => {
    expect(formatRowDate({ data: { date: '2026-05-10' } })).toMatch(/May 10/)
    expect(formatRowDate({ data: {} })).toBe('—')
    expect(formatRowDate({ data: { date: 'garbage' } })).toBe('garbage')
  })

  it('formatFinishedAt returns the finish time or empty', () => {
    expect(formatFinishedAt({ data: { finished_at: '21:29' } })).toBe('21:29')
    expect(formatFinishedAt({ data: {} })).toBe('')
  })
})
