import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/vue'
import { ref } from 'vue'

import type { MatchRecord } from '@/api-client'
import NarrowTimeScope from '@/components/matches/narrow/NarrowTimeScope.vue'
import { createMatchesNarrowState, useMatchesNarrow } from '@/composables/matches/narrow/useMatchesNarrow'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'

// The Time-scope facet is the narrow panel's coarsest gate: a season select, a
// row of preset chips, and a custom from/to pair each carrying an OPTIONAL
// HH:MM bound. The contract that matters is the state machine between those
// three — a preset resolves to a concrete bound, editing a date makes the
// scope custom, emptying the last date returns it to "all time" — plus the
// range semantics the panel writes (both ends inclusive to the minute; rows
// with no placeable time pass every range).

interface Season {
  name: string
  chapter: string
  number: number
  start: string
  end: string
}

// Explicit UTC instants: a season window is an absolute span, so the fixture
// must not shift with the runner's zone.
const SEASONS: Season[] = [
  { name: 'Reign of Talon — Season 1', chapter: 'Reign of Talon', number: 1, start: '2026-04-01T00:00:00Z', end: '2026-05-01T00:00:00Z' },
  { name: 'Reign of Talon — Season 2', chapter: 'Reign of Talon', number: 2, start: '2026-05-01T00:00:00Z', end: '2026-06-01T00:00:00Z' },
  { name: 'Null Sector — Season 3',    chapter: 'Null Sector',    number: 3, start: '2026-06-01T00:00:00Z', end: '2026-07-01T00:00:00Z' },
]

function rec(key: string, over: Record<string, unknown> = {}): MatchRecord {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: { map: 'rialto', hero: 'lucio', result: 'victory', ...over },
  } as unknown as MatchRecord
}

// Four matches straddling both ends of the window under test, plus a sentinel
// row (no parseable capture time) that must survive every range.
const CORPUS: MatchRecord[] = [
  rec('match-2026-01-07T10-59-00', { date: '2026-01-07', finished_at: '10:59' }),
  rec('match-2026-01-07T11-00-00', { date: '2026-01-07', finished_at: '11:00' }),
  rec('match-2026-01-09T22-30-00', { date: '2026-01-09', finished_at: '22:30' }),
  rec('match-2026-01-09T22-31-00', { date: '2026-01-09', finished_at: '22:31' }),
  rec('unmatched-c2Vhc29uLnBuZw'),
]

function setup(opts: { records?: MatchRecord[]; seasons?: Season[] } = {}) {
  seedQuery(qk.system.referenceData, {
    heroes_by_role: {},
    maps_by_game_mode: {},
    screenshot_sources: [],
    seasons: opts.seasons ?? [],
  })
  const state = createMatchesNarrowState()
  const narrow = useMatchesNarrow(ref(opts.records ?? []), state)
  render(NarrowTimeScope, { props: { narrow } })
  return { state, narrow }
}

const chip = (name: string) => screen.getByRole('button', { name })
const fromDate = () => screen.getByLabelText('From')
const fromTime = () => screen.getByLabelText('From time')
const toDate = () => screen.getByLabelText('To')
const toTime = () => screen.getByLabelText('To time')
const keys = (recs: MatchRecord[]) => recs.map((r) => r.match_key)

describe('NarrowTimeScope presets', () => {
  it('opens on all time, with the All-time chip the pressed one', () => {
    setup()
    expect(screen.getByText('all time')).toBeInTheDocument()
    expect(chip('All time')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Last 30d')).toHaveAttribute('aria-pressed', 'false')
  })

  it('a preset resolves to a concrete from-bound and drops the to-bound and both minute bounds', async () => {
    const { state } = setup()
    await fireEvent.update(toDate(), '2026-01-09')
    await fireEvent.update(toTime(), '22:30')

    await fireEvent.click(chip('Last 7d'))

    expect(state.pickedRange.value).toBe('7d')
    expect(state.customFrom.value).not.toBe('')
    expect(state.customTo.value).toBe('')
    expect(state.customToTime.value).toBe('')
    expect(chip('Last 7d')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('All time')).toHaveAttribute('aria-pressed', 'false')
  })

  it('a longer preset reaches further back than a shorter one', async () => {
    const { state } = setup()
    await fireEvent.click(chip('Last 7d'))
    const shortBound = state.customFrom.value
    await fireEvent.click(chip('Last 90d'))
    expect(state.customFrom.value < shortBound).toBe(true)
  })

  it('All time drops the bound the preset left behind', async () => {
    const { state, narrow } = setup()
    await fireEvent.click(chip('Last 30d'))
    expect(narrow.anyNarrow.value).toBe(true)

    await fireEvent.click(chip('All time'))
    expect(state.customFrom.value).toBe('')
    expect(narrow.anyNarrow.value).toBe(false)
    expect(screen.getByText('all time')).toBeInTheDocument()
  })
})

describe('NarrowTimeScope custom range', () => {
  it('keeps a minute bound inert until its own date is set', async () => {
    const { state } = setup()
    expect(fromTime()).toBeDisabled()
    expect(toTime()).toBeDisabled()

    await fireEvent.update(fromDate(), '2026-01-07')
    expect(fromTime()).toBeEnabled()
    expect(toTime()).toBeDisabled()
    expect(state.pickedRange.value).toBe('custom')
  })

  it('reads back both bounds with their minute tightening', async () => {
    setup()
    await fireEvent.update(fromDate(), '2026-01-07')
    await fireEvent.update(fromTime(), '11:00')
    expect(screen.getByText('2026-01-07 11:00 → …')).toBeInTheDocument()

    await fireEvent.update(toDate(), '2026-01-09')
    await fireEvent.update(toTime(), '22:30')
    expect(screen.getByText('2026-01-07 11:00 → 2026-01-09 22:30')).toBeInTheDocument()
  })

  it('narrows on both ends inclusively, and lets an undatable row through', async () => {
    const { narrow } = setup({ records: CORPUS })
    await fireEvent.update(fromDate(), '2026-01-07')
    await fireEvent.update(fromTime(), '11:00')
    await fireEvent.update(toDate(), '2026-01-09')
    await fireEvent.update(toTime(), '22:30')

    // 10:59 falls before the opening minute and 22:31 after the closing one;
    // both boundary minutes themselves are kept, and the sentinel row (no
    // placeable time) passes every range.
    expect(keys(narrow.narrowedRecords.value)).toEqual([
      'match-2026-01-07T11-00-00',
      'match-2026-01-09T22-30-00',
      'unmatched-c2Vhc29uLnBuZw',
    ])
  })

  it('emptying a date clears that side’s minute bound and re-disables it', async () => {
    const { state } = setup()
    await fireEvent.update(fromDate(), '2026-01-07')
    await fireEvent.update(fromTime(), '11:00')
    expect(state.customFromTime.value).toBe('11:00')

    await fireEvent.update(fromDate(), '')
    expect(state.customFromTime.value).toBe('')
    expect(fromTime()).toBeDisabled()
  })

  it('emptying the LAST bound returns the scope to all time', async () => {
    // Regression: clearing the dates through the inputs used to leave
    // pickedRange on 'custom' with no bounds — an active clause that filtered
    // nothing, and a meta line that read the nonsense "last custom".
    const { state, narrow } = setup({ records: CORPUS })
    await fireEvent.update(fromDate(), '2026-01-07')
    await fireEvent.update(toDate(), '2026-01-09')
    await fireEvent.update(fromDate(), '')
    expect(state.pickedRange.value).toBe('custom')

    await fireEvent.update(toDate(), '')
    expect(state.pickedRange.value).toBe('all')
    expect(narrow.anyNarrow.value).toBe(false)
    expect(screen.getByText('all time')).toBeInTheDocument()
    expect(chip('All time')).toHaveAttribute('aria-pressed', 'true')
    expect(narrow.narrowedRecords.value).toHaveLength(CORPUS.length)
  })

  it('offers Clear dates only while a bound is set, and resets everything with it', async () => {
    const { state, narrow } = setup()
    expect(screen.queryByRole('button', { name: 'Clear dates' })).not.toBeInTheDocument()

    await fireEvent.update(fromDate(), '2026-01-07')
    await fireEvent.update(fromTime(), '11:00')
    await fireEvent.click(chip('Clear dates'))

    expect(state.customFrom.value).toBe('')
    expect(state.customFromTime.value).toBe('')
    expect(state.pickedRange.value).toBe('all')
    expect(narrow.anyNarrow.value).toBe(false)
    expect(screen.queryByRole('button', { name: 'Clear dates' })).not.toBeInTheDocument()
  })
})

describe('NarrowTimeScope season select', () => {
  it('is absent while the reference data carries no seasons', () => {
    setup()
    expect(screen.queryByLabelText('Season')).not.toBeInTheDocument()
  })

  it('lists every season and scopes the set to the picked one', async () => {
    const inSeason2 = rec('match-2026-05-10T12-00-00', { played_at_utc: '2026-05-10T12:00:00Z' })
    const inSeason3 = rec('match-2026-06-10T12-00-00', { played_at_utc: '2026-06-10T12:00:00Z' })
    const { state, narrow } = setup({ records: [inSeason2, inSeason3], seasons: SEASONS })

    const select = screen.getByLabelText('Season')
    expect(select).toHaveValue('')
    for (const s of SEASONS) {
      expect(screen.getByRole('option', { name: s.name })).toBeInTheDocument()
    }

    await fireEvent.update(select, 'Reign of Talon — Season 2')
    expect(state.pickedSeason.value).toBe('Reign of Talon — Season 2')
    expect(keys(narrow.narrowedRecords.value)).toEqual(['match-2026-05-10T12-00-00'])
  })

  it('the Any season option clears the filter', async () => {
    const { state, narrow } = setup({ records: CORPUS, seasons: SEASONS })
    const select = screen.getByLabelText('Season')
    await fireEvent.update(select, 'Null Sector — Season 3')
    expect(narrow.narrowedRecords.value.length).toBeLessThan(CORPUS.length)

    await fireEvent.update(select, '')
    expect(state.pickedSeason.value).toBe('')
    expect(narrow.narrowedRecords.value).toHaveLength(CORPUS.length)
  })
})

// The phrase field is the third way to reach one filter, and the only one that
// can refuse. Its whole value rests on two properties: an accepted phrase
// writes the SAME state the chips and pickers write, and a refusal writes
// nothing at all.
describe('NarrowTimeScope date phrases', () => {
  // "this season" only resolves inside a live window, and the season fixture
  // above is deliberately historical. Build one around now instead — a
  // 60-day span centered on today, so the phrase has something to name.
  const iso = (daysFromNow: number) =>
    new Date(Date.now() + daysFromNow * 86_400_000).toISOString()
  const LIVE_SEASONS: Season[] = [
    { name: 'Null Sector — Season 9', chapter: 'Null Sector', number: 9, start: iso(-90), end: iso(-30) },
    { name: 'Null Sector — Season 10', chapter: 'Null Sector', number: 10, start: iso(-30), end: iso(30) },
  ]

  const phraseField = () => screen.getByLabelText(/describe it/i)
  const applyPhrase = async (text: string) => {
    await fireEvent.update(phraseField(), text)
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  }

  it('writes the same custom-range state a picker would', async () => {
    const { narrow } = setup()

    await applyPhrase('today')

    expect(narrow.pickedRange.value).toBe('custom')
    expect(narrow.customFrom.value).toBe(narrow.customTo.value)
    expect(narrow.customFrom.value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('resolves a season phrase to the season the select writes', async () => {
    const { narrow } = setup({ seasons: LIVE_SEASONS })

    await applyPhrase('this season')

    // The name must be one the select offers — writing a name nothing
    // recognizes would leave a lit filter matching nothing.
    expect(narrow.pickedSeason.value).toBe('Null Sector — Season 10')
  })

  it('declines a season phrase when no season is live', async () => {
    const { narrow } = setup({ seasons: SEASONS })

    await applyPhrase('this season')

    expect(screen.getAllByText(/not sure what/i).length).toBeGreaterThan(0)
    expect(narrow.pickedSeason.value).toBe('')
  })

  // The refusal contract. The e2e proves it through a row count; this proves
  // it on the state itself, which is what the count is a proxy for.
  it('leaves every date ref untouched when it cannot read the phrase', async () => {
    const { narrow } = setup({ seasons: LIVE_SEASONS })
    await applyPhrase('today')
    const before = {
      from: narrow.customFrom.value,
      to: narrow.customTo.value,
      range: narrow.pickedRange.value,
      season: narrow.pickedSeason.value,
    }

    await applyPhrase('sometime around the Mauga patch')

    // Twice by design: the paragraph a sighted user reads and the live region
    // that announces it.
    expect(screen.getAllByText(/not sure what/i)).toHaveLength(2)
    expect({
      from: narrow.customFrom.value,
      to: narrow.customTo.value,
      range: narrow.pickedRange.value,
      season: narrow.pickedSeason.value,
    }).toEqual(before)
  })

  // A phrase names ONE window. Applying a range after a season, or the
  // reverse, must not silently hand back the intersection of two windows the
  // user never asked to combine — the chips already clear the custom bounds
  // for exactly this reason.
  it('replaces the previous phrase rather than intersecting with it', async () => {
    const { narrow } = setup({ seasons: LIVE_SEASONS })

    await applyPhrase('this season')
    const season = narrow.pickedSeason.value
    await applyPhrase('today')

    expect(narrow.pickedSeason.value).toBe('')
    expect(narrow.customFrom.value).not.toBe('')

    await applyPhrase('this season')

    expect(narrow.pickedSeason.value).toBe(season)
    expect(narrow.customFrom.value).toBe('')
    expect(narrow.customTo.value).toBe('')
  })

  it('applying one season phrase twice leaves it applied', async () => {
    const { narrow } = setup({ seasons: LIVE_SEASONS })

    await applyPhrase('this season')
    const once = narrow.pickedSeason.value
    await applyPhrase('this season')

    expect(narrow.pickedSeason.value).toBe(once)
  })

  it('clears a stale refusal once a phrase reads', async () => {
    setup()

    await applyPhrase('recently')
    expect(screen.getAllByText(/not sure what/i).length).toBeGreaterThan(0)

    await applyPhrase('today')
    expect(screen.queryAllByText(/not sure what/i)).toHaveLength(0)
  })
})

