import { describe, it, expect } from 'vitest'

import { parseDatePhrase, type PhraseDeps } from '@/match/match-date-phrase'

// A Monday, late in the evening — the local-components construction matters:
// building this from an ISO string would put the "now" on a different calendar
// day for anyone west of UTC, and every boundary below would shift with it.
const NOW = new Date(2026, 7, 17, 23, 45) // 2026-08-17, a Monday

const SEASONS = [
  { name: 'Season 3', chapter: '1', number: 3, start: '2026-04-01T00:00:00Z', end: '2026-07-01T00:00:00Z' },
  { name: 'Season 4', chapter: '1', number: 4, start: '2026-07-01T00:00:00Z', end: '2026-10-01T00:00:00Z' },
]

const deps = (over: Partial<PhraseDeps> = {}): PhraseDeps => ({
  now: NOW, weekStartsOn: 0, seasons: SEASONS, ...over,
})

describe('parseDatePhrase — calendar ranges', () => {
  it('reads today and yesterday', () => {
    expect(parseDatePhrase('today', deps())).toEqual({
      kind: 'range', from: '2026-08-17', to: '2026-08-17', label: 'Today',
    })
    expect(parseDatePhrase('yesterday', deps())).toMatchObject({
      from: '2026-08-16', to: '2026-08-16',
    })
  })

  // "last week" is the previous CALENDAR week. The rolling seven days is
  // already a chip, so a phrase that duplicated it would be a second way to say
  // one thing while leaving the calendar question unanswerable.
  it('reads last week as the previous calendar week, not a rolling seven days', () => {
    const got = parseDatePhrase('last week', deps())

    // Week starts Sunday: the 17th is a Monday, so this week began the 16th and
    // last week ran the 9th through the 15th.
    expect(got).toMatchObject({ from: '2026-08-09', to: '2026-08-15' })
  })

  // A week is a calendar claim and calendars disagree about where one starts,
  // so this follows the user's own preference rather than assuming.
  it('honors a Monday week start', () => {
    const got = parseDatePhrase('last week', deps({ weekStartsOn: 1 }))

    // With Monday first, the 17th IS this week's start, so last week ran the
    // 10th through the 16th.
    expect(got).toMatchObject({ from: '2026-08-10', to: '2026-08-16' })
  })

  it('reads this week up to today, not to the end of the week', () => {
    expect(parseDatePhrase('this week', deps())).toMatchObject({
      from: '2026-08-16', to: '2026-08-17',
    })
  })

  it('reads last month as the whole month', () => {
    expect(parseDatePhrase('last month', deps())).toMatchObject({
      from: '2026-07-01', to: '2026-07-31',
    })
  })

  it('is case- and whitespace-insensitive', () => {
    expect(parseDatePhrase('  LAST   Week ', deps())).toMatchObject({ from: '2026-08-09' })
  })
})

describe('parseDatePhrase — since a weekday', () => {
  it('reaches back to the most recent past occurrence', () => {
    // The 17th is a Monday, so "since Friday" is the 14th.
    expect(parseDatePhrase('since friday', deps())).toMatchObject({
      from: '2026-08-14', to: '2026-08-17',
    })
  })

  // Saying "since Monday" ON a Monday means the one that has passed, not today
  // and certainly not next week's.
  it('goes back a full week rather than resolving to today', () => {
    expect(parseDatePhrase('since monday', deps())).toMatchObject({
      from: '2026-08-10', to: '2026-08-17',
    })
  })
})

describe('parseDatePhrase — seasons are a lookup, not a range', () => {
  it('resolves this season to the season NAME', () => {
    expect(parseDatePhrase('this season', deps())).toEqual({
      kind: 'season', name: 'Season 4', label: 'Season 4',
    })
  })

  it('resolves last season to the one before it', () => {
    expect(parseDatePhrase('last season', deps())).toMatchObject({ name: 'Season 3' })
  })

  // Without season data there is no honest answer, and inventing a date range
  // would silently answer a different question than the one asked.
  it('declines when no season data is loaded', () => {
    expect(parseDatePhrase('this season', deps({ seasons: [] }))).toBeNull()
  })

  it('declines last season when the current one is the first', () => {
    expect(parseDatePhrase('last season', deps({ seasons: [SEASONS[1]!] }))).toBeNull()
  })
})

// The refusals are the feature. A filter that guesses wrong shows the user a
// set they believe means something it does not.
describe('parseDatePhrase — what it refuses', () => {
  it.each([
    ['', 'empty input'],
    ['recently', 'no defensible boundary'],
    ['friday', 'a bare weekday could mean that day or every one of them'],
    ['before june', 'unbounded on one side, and which June'],
    ['last 3 weeks', 'not supported — the chips already cover rolling windows'],
    ['since christmas', 'not a weekday'],
    ['next week', 'there are no future matches to filter'],
    ['q3', 'ambiguous'],
  ])('declines %j (%s)', (phrase) => {
    expect(parseDatePhrase(phrase, deps())).toBeNull()
  })
})
