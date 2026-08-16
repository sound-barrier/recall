import { describe, it, expect } from 'vitest'

import {
  formatPlayerDay,
  playerClockDate,
  playerClockDayKey,
  playerClockTime,
} from '@/match/coach-time'

const thisYear = new Date().getFullYear()

// The player plays at UTC−9: her scoreboard says 21:14 on the 8th while
// the canonical instant is 06:14 UTC on the 9th. Every helper here must
// keep reading her scoreboard.
const nineHoursOff = {
  match_key: `match-${thisYear}-08-08T21-14-33`,
  data: {
    date: `${thisYear}-08-08`,
    finished_at: '21:14',
    played_at_utc: `${thisYear}-08-09T06:14:00Z`,
  },
}

describe('playerClockTime', () => {
  it("renders the naive finished_at, never the played_at_utc instant", () => {
    expect(playerClockTime(nineHoursOff)).toBe('21:14')
  })

  it('zero-pads a bare H:MM', () => {
    expect(playerClockTime({ match_key: '', data: { finished_at: '9:08' } })).toBe('09:08')
  })

  it("falls back to the match key's capture time when finished_at is empty", () => {
    expect(playerClockTime({ match_key: 'match-2026-08-08T20-05-12', data: {} })).toBe('20:05')
  })

  it("is '' for a record with neither finished_at nor a timestamped key", () => {
    expect(playerClockTime({ match_key: 'unmatched-foo.png', data: {} })).toBe('')
    expect(playerClockTime({ match_key: '', data: { played_at_utc: '2026-08-09T06:14:00Z' } })).toBe('')
  })
})

describe('playerClockDayKey', () => {
  it('is the naive data.date, not the UTC day', () => {
    expect(playerClockDayKey(nineHoursOff)).toBe(`${thisYear}-08-08`)
  })

  it("falls back to the match key's capture date when data.date is empty", () => {
    expect(playerClockDayKey({ match_key: 'match-2026-08-08T20-05-12', data: {} })).toBe('2026-08-08')
  })

  it("is '' when undated", () => {
    expect(playerClockDayKey({ match_key: 'ambiguous-abc', data: {} })).toBe('')
  })
})

describe('playerClockDate', () => {
  it('renders "Mon D" for a date in the current year', () => {
    expect(playerClockDate(nineHoursOff)).toBe('Aug 8')
  })

  it('appends the year for a date outside the current year', () => {
    expect(playerClockDate({ match_key: '', data: { date: '2019-12-31' } })).toBe('Dec 31, 2019')
  })

  it("is '' when undated", () => {
    expect(playerClockDate({ match_key: '', data: {} })).toBe('')
  })

  it('does not shift the day for a viewer behind UTC', () => {
    // A YYYY-MM-DD parsed as local midnight can roll back a day when the
    // parse is done in UTC and rendered locally; the naive key must render
    // as itself regardless of the viewer's zone.
    expect(playerClockDate({ match_key: '', data: { date: `${thisYear}-03-01` } })).toBe('Mar 1')
  })
})

describe('formatPlayerDay', () => {
  it('prefixes the weekday of the naive date', () => {
    // 2026-08-08 is a Saturday; 2026-08-07 a Friday.
    expect(formatPlayerDay('2026-08-07')).toBe(`Fri · Aug 7${thisYear === 2026 ? '' : ', 2026'}`)
    expect(formatPlayerDay('2026-08-08')).toBe(`Sat · Aug 8${thisYear === 2026 ? '' : ', 2026'}`)
  })

  it("is '' for an empty or malformed key", () => {
    expect(formatPlayerDay('')).toBe('')
    expect(formatPlayerDay('not-a-date')).toBe('')
  })
})
