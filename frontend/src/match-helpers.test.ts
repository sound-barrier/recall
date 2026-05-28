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
  formatParsedAt,
  formatMinutesAsClock,
  modeOf,
  avgGameLengthMinutes,
  highlightSubstring,
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

  it('skips annotated leaver matches when skipAnnotated=true', () => {
    const recs = [
      { data: { result: 'victory' } },
      { data: { result: 'victory' }, annotation: { leaver: 'enemy' } }, // tainted win
      { data: { result: 'defeat' }, annotation: { leaver: 'team' } },   // excused loss
      { data: { result: 'defeat' } },
    ]
    // Default behaviour counts everything.
    expect(tallyWLD(recs)).toEqual({ w: 2, l: 2, d: 0 })
    // With skipAnnotated the two annotated matches drop out.
    expect(tallyWLD(recs, true)).toEqual({ w: 1, l: 1, d: 0 })
  })

  it('a null annotation does not count as annotated for skipAnnotated', () => {
    const recs = [
      { data: { result: 'victory' }, annotation: null },
      { data: { result: 'defeat' }, annotation: { leaver: '' } }, // empty leaver = no annotation
    ]
    expect(tallyWLD(recs, true)).toEqual({ w: 1, l: 1, d: 0 })
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

  it('keeps records without a parseable date, in the UNKNOWN DATE bucket', () => {
    const out = groupMatchesByMonthWeekDay([{ data: {} }], 'desc')
    expect(out).toHaveLength(1)
    expect(out[0]!.level).toBe('unknown')
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
    // 2026-05-08 (Friday) and 2026-05-09 (Saturday) — same Sun-anchored
    // week (Sun May 3 – Sat May 9). Default weekStart is Sunday.
    const recs = [
      { data: { date: '2026-05-09', finished_at: '21:29', result: 'victory' } },
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

  it('week label uses "Week of <anchor date>" form with the Sunday anchor by default', () => {
    // Default weekStart is Sunday → 2026-05-10 (Sunday itself) anchors to itself.
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
    ]
    const week = groupMatchesByMonthWeekDay(recs, 'desc')[0]!.children![0]!
    expect(week.label).toMatch(/^Week of /)
    expect(week.label).toContain('May 10')
  })

  it('honors weekStart=1 (Monday) for the anchor', () => {
    // 2026-05-10 is a Sunday → its Monday is 2026-05-04.
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
    ]
    const week = groupMatchesByMonthWeekDay(recs, 'desc', { weekStart: 1 })[0]!.children![0]!
    expect(week.label).toContain('May 4')
  })

  it('groups Saturday + Sunday differently across weekStart 0 vs 1', () => {
    //   2026-05-09 Sat + 2026-05-10 Sun:
    //     Sunday-start (0): DIFFERENT weeks (Sat anchors to Sun May 3; Sun anchors to itself).
    //     Monday-start (1): SAME week (both anchor to Mon May 4 – Sun May 10).
    const recs = [
      { data: { date: '2026-05-09', finished_at: '21:00', result: 'victory' } },
      { data: { date: '2026-05-10', finished_at: '21:00', result: 'victory' } },
    ]
    const sun = groupMatchesByMonthWeekDay(recs, 'desc') // default Sunday
    expect(sun[0]!.children).toHaveLength(2)

    const mon = groupMatchesByMonthWeekDay(recs, 'desc', { weekStart: 1 })
    expect(mon[0]!.children).toHaveLength(1)
  })

  it('day label spells out the full weekday name (no Sun/Mon/Tue abbreviation)', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
    ]
    const day = groupMatchesByMonthWeekDay(recs, 'desc')[0]!.children![0]!.children![0]!
    // 2026-05-10 is a Sunday — full name, not "Sun".
    expect(day.label).toMatch(/^Sunday\b/)
    expect(day.label).toContain('May 10')
  })

  // ── weekStart can be any day 0-6 ─────────────────────────────────────
  //
  // Each test uses the same two records — Saturday 2026-05-09 and the
  // following Sunday 2026-05-10 — varying only the weekStart. The
  // weekend boundary makes whether they share a week a function of the
  // chosen start day.

  it('weekStart=5 (Friday) groups Fri-Thu; Sat May 9 + Sun May 10 share a Friday-anchored week', () => {
    const recs = [
      { data: { date: '2026-05-09', finished_at: '21:00', result: 'victory' } }, // Sat
      { data: { date: '2026-05-10', finished_at: '21:00', result: 'victory' } }, // Sun
    ]
    const tree = groupMatchesByMonthWeekDay(recs, 'desc', { weekStart: 5 })
    expect(tree[0]!.children).toHaveLength(1)
    expect(tree[0]!.children![0]!.label).toContain('May 8') // Friday May 8 anchors both
  })

  it('weekStart=6 (Saturday) splits Fri May 8 from Sat May 9 — Sat anchors its own week', () => {
    const recs = [
      { data: { date: '2026-05-08', finished_at: '21:00', result: 'victory' } }, // Fri, anchors to prev Sat May 2
      { data: { date: '2026-05-09', finished_at: '21:00', result: 'victory' } }, // Sat, anchors to itself
    ]
    const tree = groupMatchesByMonthWeekDay(recs, 'desc', { weekStart: 6 })
    expect(tree[0]!.children).toHaveLength(2)
  })

  it('weekStart accepts every day 0-6 without error', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:00', result: 'victory' } },
    ]
    for (let ws = 0; ws <= 6; ws++) {
      const tree = groupMatchesByMonthWeekDay(recs, 'desc', { weekStart: ws as 0 | 1 | 2 | 3 | 4 | 5 | 6 })
      expect(tree).toHaveLength(1)
      expect(tree[0]!.children![0]!.label).toMatch(/^Week of /)
    }
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

  // ── UNKNOWN DATE bucket ────────────────────────────────────────────
  //
  // Records that pass the matched-view filter (have a map) but lack a
  // data.date must NOT vanish from the tree. They get bucketed into a
  // single "UNKNOWN DATE" group, pinned at the bottom of the tree
  // regardless of sort direction. (The unknown bucket has no
  // chronological rank — it's triage, not history.)

  it('puts dateless records into a single UNKNOWN DATE group', () => {
    const tree = groupMatchesByMonthWeekDay(
      [{ data: { result: 'victory' } }],
      'desc',
    )
    expect(tree).toHaveLength(1)
    const unknown = tree[0]!
    expect(unknown.level).toBe('unknown')
    expect(unknown.label).toBe('UNKNOWN DATE')
    expect(unknown.key).toBe('unknown')
    expect(unknown.matches).toHaveLength(1)
    expect(unknown.children).toBeUndefined()
  })

  it('pins UNKNOWN DATE at the bottom under sortDir=desc', () => {
    const tree = groupMatchesByMonthWeekDay(
      [
        { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
        { data: { result: 'defeat' } }, // undated
        { data: { date: '2026-04-15', finished_at: '20:00', result: 'victory' } },
      ],
      'desc',
    )
    expect(tree.map(g => g.label)).toEqual(['MAY 2026', 'APRIL 2026', 'UNKNOWN DATE'])
    expect(tree.at(-1)!.level).toBe('unknown')
  })

  it('pins UNKNOWN DATE at the bottom under sortDir=asc (does NOT flip with sort)', () => {
    const tree = groupMatchesByMonthWeekDay(
      [
        { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
        { data: { result: 'defeat' } }, // undated
        { data: { date: '2026-04-15', finished_at: '20:00', result: 'victory' } },
      ],
      'asc',
    )
    expect(tree.map(g => g.label)).toEqual(['APRIL 2026', 'MAY 2026', 'UNKNOWN DATE'])
    expect(tree.at(-1)!.level).toBe('unknown')
  })

  it('tallies W/L/D for the UNKNOWN DATE group from the undated records', () => {
    const tree = groupMatchesByMonthWeekDay(
      [
        { data: { result: 'victory' } },
        { data: { result: 'defeat' } },
        { data: { result: 'draw' } },
        { data: { result: 'victory' } },
      ],
      'desc',
    )
    expect(tree).toHaveLength(1)
    expect(tree[0]!.tally).toEqual({ w: 2, l: 1, d: 1 })
  })

  it('returns only the UNKNOWN DATE group when every record is dateless', () => {
    const tree = groupMatchesByMonthWeekDay(
      [
        { data: { } },
        { data: { } },
      ],
      'desc',
    )
    expect(tree).toHaveLength(1)
    expect(tree[0]!.level).toBe('unknown')
    expect(tree[0]!.matches).toHaveLength(2)
  })

  it('does NOT create an UNKNOWN DATE group when every record has a date', () => {
    const tree = groupMatchesByMonthWeekDay(
      [{ data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } }],
      'desc',
    )
    expect(tree).toHaveLength(1)
    expect(tree[0]!.level).toBe('month')
    // No phantom empty unknown bucket.
    expect(tree.some(g => g.level === 'unknown')).toBe(false)
  })

  it('orders dateless records by match_key for a stable bucket order', () => {
    const tree = groupMatchesByMonthWeekDay(
      [
        { match_key: 'unmatched:zzz.png', data: { result: 'victory' } },
        { match_key: 'unmatched:aaa.png', data: { result: 'defeat' } },
        { match_key: 'unmatched:mmm.png', data: { result: 'draw' } },
      ],
      'desc',
    )
    const keys = tree[0]!.matches!.map(r => r.match_key)
    expect(keys).toEqual(['unmatched:aaa.png', 'unmatched:mmm.png', 'unmatched:zzz.png'])
  })

  it('also catches records whose date string is unparseable (not just absent)', () => {
    const tree = groupMatchesByMonthWeekDay(
      [
        { data: { date: 'not-a-date', result: 'victory' } },
      ],
      'desc',
    )
    expect(tree).toHaveLength(1)
    expect(tree[0]!.level).toBe('unknown')
  })

  // ── Year level ──────────────────────────────────────────────────────
  //
  // Multi-year datasets wrap the existing Month → Week → Day tree inside
  // Year groups. Single-year datasets unwrap the Year level so the tree
  // shape stays identical to the pre-Year behavior — no noise for the
  // common case where a user only has a few months of data.

  it('does NOT wrap in Year groups when all records fall within one year', () => {
    const tree = groupMatchesByMonthWeekDay(
      [
        { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
        { data: { date: '2026-04-15', finished_at: '20:00', result: 'defeat' } },
      ],
      'desc',
    )
    // Single year → root level is 'month', not 'year'.
    expect(tree.every(g => g.level === 'month')).toBe(true)
    expect(tree.map(g => g.label)).toEqual(['MAY 2026', 'APRIL 2026'])
  })

  it('wraps in Year groups when records span multiple years', () => {
    const tree = groupMatchesByMonthWeekDay(
      [
        { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
        { data: { date: '2025-12-30', finished_at: '20:00', result: 'defeat' } },
      ],
      'desc',
    )
    expect(tree).toHaveLength(2)
    expect(tree[0]!.level).toBe('year')
    expect(tree[0]!.label).toBe('2026')
    expect(tree[1]!.label).toBe('2025')
  })

  it('keys Year groups as "year:<YYYY>"', () => {
    const tree = groupMatchesByMonthWeekDay(
      [
        { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
        { data: { date: '2025-12-30', finished_at: '20:00', result: 'defeat' } },
      ],
      'desc',
    )
    expect(tree[0]!.key).toBe('year:2026')
    expect(tree[1]!.key).toBe('year:2025')
  })

  it('year tally equals sum of its month tallies', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
      { data: { date: '2026-03-15', finished_at: '20:00', result: 'defeat' } },
      { data: { date: '2025-11-01', finished_at: '20:00', result: 'draw' } },
    ]
    const tree = groupMatchesByMonthWeekDay(recs, 'desc')
    const y2026 = tree[0]!
    const monthSum = y2026.children!.reduce(
      (acc, m) => ({ w: acc.w + m.tally.w, l: acc.l + m.tally.l, d: acc.d + m.tally.d }),
      { w: 0, l: 0, d: 0 },
    )
    expect(monthSum).toEqual(y2026.tally)
    expect(y2026.tally).toEqual({ w: 1, l: 1, d: 0 })
  })

  it('reorders Year groups under sortDir', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
      { data: { date: '2025-12-30', finished_at: '20:00', result: 'defeat' } },
    ]
    const desc = groupMatchesByMonthWeekDay(recs, 'desc')
    expect(desc.map(g => g.label)).toEqual(['2026', '2025'])
    const asc = groupMatchesByMonthWeekDay(recs, 'asc')
    expect(asc.map(g => g.label)).toEqual(['2025', '2026'])
  })

  it('keeps the UNKNOWN DATE bucket at the bottom irrespective of year wrapping', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
      { data: { date: '2025-12-30', finished_at: '20:00', result: 'defeat' } },
      { match_key: 'unmatched:x.png', data: { result: 'victory' } },
    ]
    const tree = groupMatchesByMonthWeekDay(recs, 'desc')
    expect(tree).toHaveLength(3)
    expect(tree.at(-1)!.level).toBe('unknown')
    // The two year wrappers come before unknown.
    expect(tree.slice(0, 2).every(g => g.level === 'year')).toBe(true)
  })

  it('within a Year, months / weeks / days follow the normal sort + structure', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
      { data: { date: '2026-04-15', finished_at: '20:00', result: 'victory' } },
      { data: { date: '2025-11-01', finished_at: '20:00', result: 'defeat' } },
    ]
    const tree = groupMatchesByMonthWeekDay(recs, 'desc')
    const y2026 = tree[0]!
    // 2026 has two months in newest-first order.
    expect(y2026.children!.map(m => m.label)).toEqual(['MAY 2026', 'APRIL 2026'])
    // Drill into the first month → week → day still works.
    const may = y2026.children![0]!
    expect(may.children![0]!.level).toBe('week')
    expect(may.children![0]!.children![0]!.level).toBe('day')
    expect(may.children![0]!.children![0]!.matches).toHaveLength(1)
  })
})

// ─── formatParsedAt ──────────────────────────────────────────────────

describe('formatParsedAt', () => {
  it('returns empty for empty / null / undefined input', () => {
    expect(formatParsedAt('')).toBe('')
    expect(formatParsedAt(null)).toBe('')
    expect(formatParsedAt(undefined)).toBe('')
  })

  it('formats a valid ISO8601 string as "Month D, YYYY @ h:mmpm" (local time)', () => {
    // Test in a UTC-relative way so it doesn't break across timezones —
    // pick a value that round-trips through new Date and assert on the
    // overall shape rather than the exact hour.
    const out = formatParsedAt('2026-05-10T21:30:00Z')
    expect(out).toMatch(/^May 1[01], 2026 @ \d{1,2}:\d{2}(am|pm)$/)
  })

  it('returns the raw string for unparseable input rather than crashing', () => {
    expect(formatParsedAt('definitely not a date')).toBe('definitely not a date')
  })

  it('uses 12-hour format with am/pm — never 24-hour', () => {
    // 13:00 UTC → in local time will be hour 13±offset. Either way the
    // formatted hour must be 1–12, never 13–23.
    const out = formatParsedAt('2026-05-10T13:00:00Z')
    const m = out.match(/@ (\d{1,2}):\d{2}(am|pm)$/)
    expect(m).not.toBeNull()
    const hr = Number(m![1])
    expect(hr).toBeGreaterThanOrEqual(1)
    expect(hr).toBeLessThanOrEqual(12)
  })

  it('zero-pads the minutes', () => {
    const out = formatParsedAt('2026-05-10T13:05:00Z')
    expect(out).toMatch(/:05(am|pm)$/)
  })

  it('renders midnight as 12 (not 0)', () => {
    // Pick a UTC time where SOMEONE'S local midnight will fire.
    // For deterministic test: use vi.setSystemTime equivalent via
    // Date constructor — but here we're checking the formatter
    // never emits "0:00". Easier: stub Date in a focused test.
    const out = formatParsedAt('2026-05-10T05:00:00Z')
    expect(out).not.toMatch(/@ 0:/)
  })
})

// ─── formatMinutesAsClock ───────────────────────────────────────────

describe('formatMinutesAsClock', () => {
  it('renders integer minutes as "N:00"', () => {
    expect(formatMinutesAsClock(11)).toBe('11:00')
  })

  it('rounds fractional minutes to the nearest second', () => {
    // 11.5 min = 11m 30s; 11.51 min = 11m 30.6s = 31s after round.
    expect(formatMinutesAsClock(11.5)).toBe('11:30')
    expect(formatMinutesAsClock(11.51)).toBe('11:31')
  })

  it('zero-pads seconds < 10', () => {
    expect(formatMinutesAsClock(11 + 5 / 60)).toBe('11:05')
  })

  it('renders null / undefined / NaN as em-dash', () => {
    expect(formatMinutesAsClock(null)).toBe('—')
    expect(formatMinutesAsClock(undefined)).toBe('—')
    expect(formatMinutesAsClock(NaN)).toBe('—')
    expect(formatMinutesAsClock(-1)).toBe('—')
  })

  it('handles >60 minute values (carries into another minutes slot)', () => {
    // 65.5 minutes = 65m 30s. The clock format doesn't escape into
    // hours — that's the agg-stats panel's choice — but the
    // mm:ss split must still be correct.
    expect(formatMinutesAsClock(65.5)).toBe('65:30')
  })
})

// ─── modeOf ────────────────────────────────────────────────────────

describe('modeOf', () => {
  it('returns the most-common value with its count', () => {
    const recs = [
      { hero: 'lucio' },
      { hero: 'lucio' },
      { hero: 'ana' },
    ]
    expect(modeOf(recs, r => r.hero)).toEqual({ value: 'lucio', count: 2 })
  })

  it('returns null when the record set is empty', () => {
    expect(modeOf([], r => (r as { hero: string }).hero)).toBeNull()
  })

  it('returns null when every picker result is null/undefined/empty', () => {
    expect(modeOf([{ hero: null }, { hero: '' }, { hero: undefined }], r => r.hero)).toBeNull()
  })

  it('ignores null / undefined / empty-string values from the picker', () => {
    const recs = [{ hero: 'lucio' }, { hero: null }, { hero: 'lucio' }, { hero: '' }]
    expect(modeOf(recs, r => r.hero)).toEqual({ value: 'lucio', count: 2 })
  })

  it('breaks ties alphabetically so the readout is stable across reloads', () => {
    // "ana" and "lucio" both appear twice; "ana" is alphabetically
    // earlier so it wins the tie even though it was seen first.
    const recs = [
      { hero: 'lucio' },
      { hero: 'lucio' },
      { hero: 'ana' },
      { hero: 'ana' },
    ]
    expect(modeOf(recs, r => r.hero)).toEqual({ value: 'ana', count: 2 })
  })
})

// ─── avgGameLengthMinutes ──────────────────────────────────────────

describe('avgGameLengthMinutes', () => {
  it('averages parseable game lengths in fractional minutes', () => {
    const recs = [
      { data: { game_length: '10:00' } },
      { data: { game_length: '12:00' } },
    ]
    expect(avgGameLengthMinutes(recs)).toBe(11)
  })

  it('skips records with missing / unparseable game_length', () => {
    const recs = [
      { data: { game_length: '10:00' } },
      { data: { game_length: null } },
      { data: { game_length: '' } },
      { data: { game_length: 'not a duration' } },
      { data: { game_length: '14:00' } },
    ]
    expect(avgGameLengthMinutes(recs)).toBe(12)
  })

  it('returns null when no record contributes a parseable value', () => {
    expect(avgGameLengthMinutes([])).toBeNull()
    expect(avgGameLengthMinutes([{ data: { game_length: null } }])).toBeNull()
  })

  it('handles records with no data object at all', () => {
    expect(avgGameLengthMinutes([{ data: null }])).toBeNull()
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
