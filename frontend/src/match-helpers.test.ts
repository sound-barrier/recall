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
  tallyWLD,
  groupMatchesByMonthWeekDay,
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

// ─── tallyWLD ────────────────────────────────────────────────────────
//
// W/L/D rollup. Counted case-insensitively (the parser stores "victory"
// / "defeat" / "draw" but earlier rows have varying casing). Any other
// value (empty, unknown, "in progress") is silently ignored — partial
// rolls always sum to W+L+D ≤ length.

describe('tallyWLD', () => {
  it('counts wins, losses, draws case-insensitively', () => {
    const t = tallyWLD([
      { data: { result: 'victory' } },
      { data: { result: 'VICTORY' } },
      { data: { result: 'defeat' } },
      { data: { result: 'Draw' } },
      { data: { result: 'draw' } },
    ])
    expect(t).toEqual({ w: 2, l: 1, d: 2 })
  })

  it('ignores rows without a result (no inference)', () => {
    const t = tallyWLD([
      { data: { result: 'victory' } },
      { data: {} },
      { data: { result: '' } },
      { data: { result: 'unknown' } },
    ])
    expect(t).toEqual({ w: 1, l: 0, d: 0 })
  })

  it('returns zeros for an empty input', () => {
    expect(tallyWLD([])).toEqual({ w: 0, l: 0, d: 0 })
  })
})

// ─── groupMatchesByMonthWeekDay ──────────────────────────────────────
//
// Three-level tree (Month → Week → Day). Each level carries its own
// W/L/D tally — the month tally is the sum of its weeks; the week is
// the sum of its days. The Monday of each week is the day-bucket key
// so weeks straddle month boundaries gracefully.

describe('groupMatchesByMonthWeekDay', () => {
  it('returns an empty array for an empty input', () => {
    expect(groupMatchesByMonthWeekDay([], 'desc')).toEqual([])
  })

  it('drops records without a parseable date (cannot group them)', () => {
    const out = groupMatchesByMonthWeekDay([{ data: {} }], 'desc')
    expect(out).toEqual([])
  })

  it('groups three records on the same day under one Month/Week/Day', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
      { data: { date: '2026-05-10', finished_at: '22:05', result: 'defeat' } },
      { data: { date: '2026-05-10', finished_at: '22:40', result: 'victory' } },
    ]
    const tree = groupMatchesByMonthWeekDay(recs, 'desc')
    expect(tree).toHaveLength(1)
    const month = tree[0]!
    expect(month.level).toBe('month')
    expect(month.tally).toEqual({ w: 2, l: 1, d: 0 })
    expect(month.children).toHaveLength(1)

    const week = month.children![0]!
    expect(week.level).toBe('week')
    expect(week.tally).toEqual({ w: 2, l: 1, d: 0 })
    expect(week.children).toHaveLength(1)

    const day = week.children![0]!
    expect(day.level).toBe('day')
    expect(day.tally).toEqual({ w: 2, l: 1, d: 0 })
    expect(day.matches).toHaveLength(3)
  })

  it('splits two days within the same week into two Day groups', () => {
    // 2026-05-10 (Sunday) and 2026-05-08 (Friday) — same ISO week.
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
      { data: { date: '2026-05-08', finished_at: '20:00', result: 'defeat' } },
    ]
    const tree = groupMatchesByMonthWeekDay(recs, 'desc')
    expect(tree).toHaveLength(1)
    expect(tree[0]!.children).toHaveLength(1)
    expect(tree[0]!.children![0]!.children).toHaveLength(2)
  })

  it('keys each Month/Week/Day uniquely and stably across calls', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
    ]
    const a = groupMatchesByMonthWeekDay(recs, 'desc')
    const b = groupMatchesByMonthWeekDay(recs, 'desc')
    expect(a[0]!.key).toBe(b[0]!.key)
    expect(a[0]!.children![0]!.key).toBe(b[0]!.children![0]!.key)
    expect(a[0]!.children![0]!.children![0]!.key).toBe(b[0]!.children![0]!.children![0]!.key)
  })

  it('orders groups newest → oldest under sortDir=desc', () => {
    const recs = [
      { data: { date: '2026-04-15', finished_at: '20:00', result: 'victory' } },
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
      { data: { date: '2026-05-03', finished_at: '21:00', result: 'defeat' } },
    ]
    const tree = groupMatchesByMonthWeekDay(recs, 'desc')
    // Months: May 2026 first, then April 2026.
    expect(tree.map(g => g.label)).toEqual(['MAY 2026', 'APRIL 2026'])
    const may = tree[0]!
    // Within May, week of May 10 (Mon May 4-Sun 10? actually depends on
    // anchor; just assert the dates are in the right relative position).
    const firstWeekFirstDay = may.children![0]!.children![0]!.matches![0]!
    expect(firstWeekFirstDay.data!.date).toBe('2026-05-10')
  })

  it('orders groups oldest → newest under sortDir=asc', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
      { data: { date: '2026-04-15', finished_at: '20:00', result: 'victory' } },
    ]
    const tree = groupMatchesByMonthWeekDay(recs, 'asc')
    expect(tree.map(g => g.label)).toEqual(['APRIL 2026', 'MAY 2026'])
  })

  it('week label uses "Week of <Mon date>" form', () => {
    // 2026-05-10 is a Sunday → its Monday is 2026-05-04.
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
    ]
    const week = groupMatchesByMonthWeekDay(recs, 'desc')[0]!.children![0]!
    expect(week.label).toMatch(/^Week of /)
    // Must reference the Monday of that ISO week.
    expect(week.label).toContain('May 4')
  })

  it('day label uses a short weekday + month + day form', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
    ]
    const day = groupMatchesByMonthWeekDay(recs, 'desc')[0]!.children![0]!.children![0]!
    // 2026-05-10 is a Sunday.
    expect(day.label).toMatch(/^Sun/)
    expect(day.label).toContain('May 10')
  })

  it('month tally equals sum of week tallies', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
      { data: { date: '2026-05-03', finished_at: '21:00', result: 'defeat' } },
      { data: { date: '2026-05-01', finished_at: '21:00', result: 'draw' } },
    ]
    const month = groupMatchesByMonthWeekDay(recs, 'desc')[0]!
    const weekTotal = month.children!.reduce(
      (acc, w) => ({ w: acc.w + w.tally.w, l: acc.l + w.tally.l, d: acc.d + w.tally.d }),
      { w: 0, l: 0, d: 0 },
    )
    expect(weekTotal).toEqual(month.tally)
    expect(month.tally).toEqual({ w: 1, l: 1, d: 1 })
  })

  it('matches inside a day are sorted by finished_at honoring sortDir', () => {
    const recs = [
      { match_key: 'a', data: { date: '2026-05-10', finished_at: '20:00', result: 'victory' } },
      { match_key: 'b', data: { date: '2026-05-10', finished_at: '22:00', result: 'defeat' } },
      { match_key: 'c', data: { date: '2026-05-10', finished_at: '21:00', result: 'draw' } },
    ]
    const desc = groupMatchesByMonthWeekDay(recs, 'desc')[0]!.children![0]!.children![0]!.matches!
    expect(desc.map(r => r.match_key)).toEqual(['b', 'c', 'a'])

    const asc = groupMatchesByMonthWeekDay(recs, 'asc')[0]!.children![0]!.children![0]!.matches!
    expect(asc.map(r => r.match_key)).toEqual(['a', 'c', 'b'])
  })

  it('splits a week that straddles a month boundary into both month buckets', () => {
    // 2026-05-31 is a Sunday — same ISO week as 2026-06-01 (Monday)?
    // Actually 2026-05-31 Sun is the END of its week (Mon May 25 - Sun May 31).
    // Use 2026-04-30 (Thu) and 2026-05-01 (Fri) — same ISO week.
    const recs = [
      { match_key: 'apr', data: { date: '2026-04-30', finished_at: '21:00', result: 'victory' } },
      { match_key: 'may', data: { date: '2026-05-01', finished_at: '21:00', result: 'defeat' } },
    ]
    const tree = groupMatchesByMonthWeekDay(recs, 'desc')
    // Two month buckets, each containing the same calendar week.
    expect(tree).toHaveLength(2)
    const may = tree[0]!
    const apr = tree[1]!
    expect(may.label).toBe('MAY 2026')
    expect(apr.label).toBe('APRIL 2026')
    // The same Monday anchors the week in both buckets.
    expect(may.children![0]!.key).toBe(apr.children![0]!.key)
    // But each month bucket holds only its own day(s).
    expect(may.children![0]!.children!.map(d => d.matches!.length)).toEqual([1])
    expect(apr.children![0]!.children!.map(d => d.matches!.length)).toEqual([1])
  })
})
