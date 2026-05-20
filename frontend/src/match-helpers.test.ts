import { vi, describe, it, expect, afterEach } from 'vitest'
import {
  SCREENSHOT_TYPES,
  sshotTypeLabel,
  sourceType,
  detectScreenshotSlots,
  missingRequiredSlots,
  missingOptionalSlots,
  heroesForHeader,
  matchTime,
  fmtTime,
  formatRelativeTime,
  screenshotURL,
  computeEarliestMatchDateTime,
} from './match-helpers'

// ─── sshotTypeLabel ──────────────────────────────────────────────────

describe('sshotTypeLabel', () => {
  it('maps scoreboard → TEAMS (the UI label everywhere else)', () => {
    expect(sshotTypeLabel('scoreboard')).toBe('TEAMS')
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
    expect(slots.filter(s => s.required).map(s => s.key)).toEqual(['summary', 'scoreboard', 'personal'])
    expect(slots.filter(s => !s.required).map(s => s.key)).toEqual(['rank'])
  })

  describe('with stored source_types (authoritative)', () => {
    it('marks only the present types — scoreboard + rank', () => {
      const rec = {
        source_types: { 'a.png': 'scoreboard' as const, 'b.png': 'rank' as const },
        data: { eliminations: 17 },
      }
      const present = detectScreenshotSlots(rec).filter(s => s.present).map(s => s.key)
      expect(present).toEqual(['scoreboard', 'rank'])
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
          'b.png': 'scoreboard' as const,
          'c.png': 'personal' as const,
          'd.png': 'rank' as const,
        },
        data: {},
      }
      expect(detectScreenshotSlots(rec).every(s => s.present)).toBe(true)
    })
  })

  describe('without stored source_types (fallback inference)', () => {
    it('combat stats > 0 → TEAMS present', () => {
      const rec = { data: { eliminations: 17, deaths: 11 } }
      expect(detectScreenshotSlots(rec).find(s => s.key === 'scoreboard')!.present).toBe(true)
    })

    it('SUMMARY-only fields → SUMMARY present', () => {
      const rec = { data: { final_score: '3-1', game_length: '11:25' } }
      expect(detectScreenshotSlots(rec).find(s => s.key === 'summary')!.present).toBe(true)
    })

    it('hero stats with combat > 0 does NOT light up PERSONAL (scoreboard wins)', () => {
      // Without source_types, scoreboard's right-panel stats would falsely
      // light up PERSONAL. Fix: PERSONAL fallback requires combatTotal === 0.
      const rec = {
        data: {
          eliminations: 17,
          heroes_played: [{ hero: 'lucio', percent_played: 100, stats: { weapon_accuracy: 24 } }],
        },
      }
      const slots = detectScreenshotSlots(rec)
      expect(slots.find(s => s.key === 'scoreboard')!.present).toBe(true)
      expect(slots.find(s => s.key === 'personal')!.present).toBe(false)
    })

    it('hero stats with no combat → PERSONAL present', () => {
      const rec = {
        data: {
          heroes_played: [{ hero: 'lucio', percent_played: 100, stats: { weapon_accuracy: 24 } }],
        },
      }
      expect(detectScreenshotSlots(rec).find(s => s.key === 'personal')!.present).toBe(true)
    })

    it('rank/level/sr → RANK present', () => {
      const rec = { data: { rank: 'platinum', level: 5 } }
      expect(detectScreenshotSlots(rec).find(s => s.key === 'rank')!.present).toBe(true)
    })

    it('result alone does NOT light up SUMMARY (inferResultFromRank false-positive guard)', () => {
      // result can be inferred from SR change at read time; SUMMARY chip
      // must not light up just because result is set.
      const rec = { data: { result: 'victory' as const } }
      expect(detectScreenshotSlots(rec).find(s => s.key === 'summary')!.present).toBe(false)
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
    expect(reqMissing).toEqual(['summary', 'scoreboard'])
    expect(optMissing).toEqual([])
  })

  it('complete match → no missing slots in either category', () => {
    const rec = {
      source_types: {
        'a.png': 'summary' as const,
        'b.png': 'scoreboard' as const,
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
        'b.png': 'scoreboard' as const,
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

// ─── matchTime ───────────────────────────────────────────────────────

describe('matchTime', () => {
  it('prefers date + finished_at (SUMMARY)', () => {
    const rec = {
      match_key: 'match:2026-05-10T21:29:28',
      data: { date: '2026-05-10', finished_at: '21:29' },
    }
    expect(matchTime(rec)).toBe('2026-05-10T21:29')
  })

  it('falls back to match_key prefix when SUMMARY missing', () => {
    const rec = { match_key: 'match:2026-05-10T21:29:28', data: {} }
    expect(matchTime(rec)).toBe('2026-05-10T21:29:28')
  })

  it('returns "" for unmatched: keys (no parseable timestamp)', () => {
    const rec = { match_key: 'unmatched:foo.png', data: {} }
    expect(matchTime(rec)).toBe('')
  })

  it('returns "" when neither date nor match_key is parseable', () => {
    expect(matchTime({ match_key: '', data: {} })).toBe('')
  })
})

// ─── fmtTime ─────────────────────────────────────────────────────────

describe('fmtTime', () => {
  it('renders "Month D, YYYY @ H:MMam/pm" when both date and time present', () => {
    const rec = { data: { date: '2026-05-09', finished_at: '21:08' } }
    expect(fmtTime(rec)).toBe('May 9, 2026 @ 9:08pm')
  })

  it('handles midnight as 12am', () => {
    const rec = { data: { date: '2026-05-09', finished_at: '00:30' } }
    expect(fmtTime(rec)).toBe('May 9, 2026 @ 12:30am')
  })

  it('handles noon as 12pm', () => {
    const rec = { data: { date: '2026-05-09', finished_at: '12:00' } }
    expect(fmtTime(rec)).toBe('May 9, 2026 @ 12:00pm')
  })

  it('returns date alone when finished_at is missing', () => {
    expect(fmtTime({ data: { date: '2026-05-09' } })).toBe('May 9, 2026')
  })

  it('returns time alone when date is missing', () => {
    expect(fmtTime({ data: { finished_at: '21:08' } })).toBe('9:08pm')
  })

  it('returns "" when neither is set', () => {
    expect(fmtTime({ data: {} })).toBe('')
  })

  it('does not zero-pad the day-of-month', () => {
    const rec = { data: { date: '2026-05-03', finished_at: '15:00' } }
    expect(fmtTime(rec)).toMatch(/May 3, 2026/)
  })
})

// ─── formatRelativeTime ──────────────────────────────────────────────

describe('formatRelativeTime', () => {
  afterEach(() => { vi.useRealTimers() })

  it('returns "" for null / undefined / 0', () => {
    expect(formatRelativeTime(null)).toBe('')
    expect(formatRelativeTime(undefined)).toBe('')
    expect(formatRelativeTime(0)).toBe('')
  })

  it('returns "just now" for events within 60 seconds', () => {
    const now = 1_748_000_000_000
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(formatRelativeTime(now - 30_000)).toBe('just now')
    expect(formatRelativeTime(now - 59_999)).toBe('just now')
  })

  it('returns "just now" for future timestamps', () => {
    const now = 1_748_000_000_000
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(formatRelativeTime(now + 5_000)).toBe('just now')
  })

  it('returns "1 minute ago" at exactly 60 s', () => {
    const now = 1_748_000_000_000
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(formatRelativeTime(now - 60_000)).toBe('1 minute ago')
  })

  it('returns "N minutes ago" for 2–59 minutes', () => {
    const now = 1_748_000_000_000
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(formatRelativeTime(now - 5 * 60_000)).toBe('5 minutes ago')
    expect(formatRelativeTime(now - 59 * 60_000)).toBe('59 minutes ago')
  })

  it('returns "1 hour ago" at exactly 1 hour', () => {
    const now = 1_748_000_000_000
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(formatRelativeTime(now - 3_600_000)).toBe('1 hour ago')
  })

  it('returns "N hours ago" for 2–23 hours', () => {
    const now = 1_748_000_000_000
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(formatRelativeTime(now - 2 * 3_600_000)).toBe('2 hours ago')
    expect(formatRelativeTime(now - 23 * 3_600_000)).toBe('23 hours ago')
  })

  it('returns "yesterday" at exactly 1 day', () => {
    const now = 1_748_000_000_000
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(formatRelativeTime(now - 86_400_000)).toBe('yesterday')
  })

  it('returns "N days ago" for 2+ days', () => {
    const now = 1_748_000_000_000
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(formatRelativeTime(now - 3 * 86_400_000)).toBe('3 days ago')
  })
})

// ─── screenshotURL ───────────────────────────────────────────────────

describe('screenshotURL', () => {
  it('builds the expected path for a plain filename', () => {
    expect(screenshotURL('foo.png')).toBe('/_screenshot/foo.png')
  })

  it('percent-encodes spaces', () => {
    expect(screenshotURL('my file.png')).toBe('/_screenshot/my%20file.png')
  })

  it('encodes & and = (common in OW screenshot naming)', () => {
    expect(screenshotURL('a&b=c.png')).toBe('/_screenshot/a%26b%3Dc.png')
  })
})

// ─── computeEarliestMatchDateTime ────────────────────────────────────

describe('computeEarliestMatchDateTime', () => {
  it('returns "" for an empty list', () => {
    expect(computeEarliestMatchDateTime([])).toBe('')
  })

  it('returns "" when no records have both date and finished_at', () => {
    expect(computeEarliestMatchDateTime([
      { data: { hero: 'lucio' } },
      { data: { date: '2026-05-10' } },
    ])).toBe('')
  })

  it('returns the timestamp when exactly one record qualifies', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:00' } },
      { data: {} },
    ]
    expect(computeEarliestMatchDateTime(recs)).toBe('2026-05-10T21:00')
  })

  it('returns the earliest across multiple qualifying records', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:00' } },
      { data: { date: '2026-04-01', finished_at: '09:00' } },
      { data: { date: '2026-05-15', finished_at: '14:30' } },
    ]
    expect(computeEarliestMatchDateTime(recs)).toBe('2026-04-01T09:00')
  })

  it('handles same-day records by comparing HH:MM', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '22:00' } },
      { data: { date: '2026-05-10', finished_at: '08:30' } },
    ]
    expect(computeEarliestMatchDateTime(recs)).toBe('2026-05-10T08:30')
  })
})
