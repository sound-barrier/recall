import { vi, describe, it, expect, afterEach } from 'vitest'
import {
  matchTime,
  fmtTime,
  formatRelativeTime,
  computeEarliestMatchDateTime,
  formatParsedAt,
  formatMinutesAsClock,
  formatPlayMinutes,
} from '@/match/match-time-helpers'

// ─── matchTime ───────────────────────────────────────────────────────

describe('matchTime', () => {
  it('prefers date + finished_at (SUMMARY)', () => {
    const rec = {
      match_key: 'match-2026-05-10T21-29-28',
      data: { date: '2026-05-10', finished_at: '21:29' },
    }
    expect(matchTime(rec)).toBe('2026-05-10T21:29')
  })

  it('falls back to match_key prefix when SUMMARY missing', () => {
    const rec = { match_key: 'match-2026-05-10T21-29-28', data: {} }
    expect(matchTime(rec)).toBe('2026-05-10T21:29:28')
  })

  it('returns "" for unmatched: keys (no parseable timestamp)', () => {
    const rec = { match_key: 'unmatched-foo.png', data: {} }
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

// ─── formatPlayMinutes ─────────────────────────────────────────────

describe('formatPlayMinutes', () => {
  it('renders sub-hour totals as "Nmin"', () => {
    expect(formatPlayMinutes(32)).toBe('32min')
    expect(formatPlayMinutes(11.42)).toBe('11min') // 11m 25s rounds to 11
    expect(formatPlayMinutes(11.51)).toBe('12min') // 11m 30.6s rounds to 12
  })

  it('renders hour-plus totals as "XhYmin"', () => {
    expect(formatPlayMinutes(60)).toBe('1h0min')
    expect(formatPlayMinutes(7 * 60 + 32)).toBe('7h32min')
    expect(formatPlayMinutes(125)).toBe('2h5min')
  })

  it('rounds sub-minute totals to "0min" (data shape, not absence)', () => {
    expect(formatPlayMinutes(0.4)).toBe('0min')
    expect(formatPlayMinutes(0)).toBe('0min')
  })

  it('renders null / undefined / NaN / negative as em-dash', () => {
    expect(formatPlayMinutes(null)).toBe('—')
    expect(formatPlayMinutes(undefined)).toBe('—')
    expect(formatPlayMinutes(NaN)).toBe('—')
    expect(formatPlayMinutes(-1)).toBe('—')
  })
})
