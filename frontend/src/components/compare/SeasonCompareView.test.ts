import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'

import type { MatchRecord, OWData } from '@/api'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'
import SeasonCompareView from '@/components/compare/SeasonCompareView.vue'
import { useMatchesStore } from '@/stores/matches'

// The Compare tab shell: the season picker + scope switch + mode switch, and
// the four render branches around them (too-few-seasons, same-season warning,
// the excluded-matches note, and the Form hand-off). Server state is seeded
// through the query cache before the stores exist, per the query-cache test
// hygiene rules.

const S1 = 'Reign of Talon — Season 1'
const S2 = 'Reign of Talon — Season 2'

const SEASONS = [
  { name: S1, chapter: 'Reign of Talon', number: 1, start: '2026-02-10T19:00:00Z', end: '2026-04-14T19:00:00Z' },
  { name: S2, chapter: 'Reign of Talon', number: 2, start: '2026-04-14T19:00:00Z', end: '2026-06-16T19:00:00Z' },
]

function owData(seasons: OWData['seasons']): OWData {
  return {
    heroes_by_role: { support: ['Lúcio'], dps: ['Genji'], tank: ['Reinhardt'] },
    maps_by_game_mode: { escort: ['Rialto'] },
    screenshot_sources: [],
    seasons,
    ranks: [],
  }
}

let seq = 0

interface RecOpts {
  utc: string
  result?: 'victory' | 'defeat' | 'draw'
  hero?: string
}

function record({ utc, result = 'victory', hero = 'lucio' }: RecOpts): MatchRecord {
  seq++
  const date = utc.slice(0, 10)
  return {
    match_key: `match-${date}T1${seq % 10}-00-00`,
    source_files: [`${seq}.png`],
    data: {
      map: 'rialto',
      game_mode: 'escort',
      playlist: 'competitive',
      role: 'support',
      hero,
      result,
      date,
      finished_at: `1${seq % 10}:00`,
      played_at_utc: utc,
      heroes_played: [{ hero, percent_played: 100 }],
    },
    parsed_at: `${date}T23:59:00Z`,
  }
}

let pinia: Pinia

function seed(records: MatchRecord[], seasons: OWData['seasons'] = SEASONS) {
  pinia = createPinia()
  setActivePinia(pinia)
  seedQuery(qk.system.referenceData, owData(seasons))
  seedQuery(qk.matches, records)
  seedQuery(qk.pendingCount, 0)
  seedQuery(qk.failedFiles, [])
}

async function renderCompare(records: MatchRecord[], seasons: OWData['seasons'] = SEASONS) {
  seed(records, seasons)
  const view = render(SeasonCompareView, { global: { plugins: [pinia] } })
  await new Promise((r) => setTimeout(r, 0))
  return view
}

// The A/B/Δ table row for a metric label, so assertions read as
// "Games: 3 in A, 1 in B" instead of poking at cells.
function metricRow(label: string) {
  return screen.getByRole('rowheader', { name: label }).closest('tr')!
}

function columns(label: string): string[] {
  return within(metricRow(label)).getAllByRole('cell').map((c) => c.textContent?.trim() ?? '')
}

afterEach(async () => {
  await vi.dynamicImportSettled()
  vi.clearAllMocks()
})

describe('SeasonCompareView', () => {
  beforeEach(() => { seq = 0 })

  it('refuses to compare and explains why when fewer than two seasons exist', async () => {
    await renderCompare([], [SEASONS[0]!])
    expect(screen.getByText('Not enough seasons yet.')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Comparison metrics' })).not.toBeInTheDocument()
    // The mode switch stays reachable — Form doesn't need seasons.
    expect(screen.getByRole('button', { name: 'Form' })).toBeInTheDocument()
  })

  it('defaults the picks to the two most recent seasons and heads each column with them', async () => {
    await renderCompare([record({ utc: '2026-03-01T12:00:00Z' })])
    expect(screen.getByLabelText('Baseline (A)')).toHaveValue(S1)
    expect(screen.getByLabelText('Compared (B)')).toHaveValue(S2)
    expect(screen.getByRole('columnheader', { name: S1 })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: S2 })).toBeInTheDocument()
  })

  it('splits records into the picked seasons by their canonical UTC start', async () => {
    await renderCompare([
      record({ utc: '2026-03-01T12:00:00Z' }),
      record({ utc: '2026-03-02T12:00:00Z' }),
      record({ utc: '2026-05-01T12:00:00Z' }),
    ])
    // Metric | A | B | Δ — two games in season 1, one in season 2.
    expect(columns('Games')).toEqual(['2', '1', '−1'])
  })

  it('warns instead of comparing a season against itself', async () => {
    await renderCompare([record({ utc: '2026-03-01T12:00:00Z' })])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await fireEvent.update(screen.getByLabelText('Compared (B)'), S1)
    expect(screen.getByRole('alert')).toHaveTextContent('Pick two different seasons')
    expect(columns('Games')).toEqual(['1', '1', '0'])
  })

  it('announces the comparison and its scope, and re-announces on a scope switch', async () => {
    await renderCompare([record({ utc: '2026-03-01T12:00:00Z' })])
    expect(screen.getByText(`Comparing ${S1} versus ${S2}, full seasons.`)).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'Current filter' }))
    expect(screen.getByText(`Comparing ${S1} versus ${S2}, current filter.`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Current filter' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Full seasons' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Comparing the current Matches filter, applied within each season.')).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'Full seasons' }))
    expect(screen.getByText(`Comparing ${S1} versus ${S2}, full seasons.`)).toBeInTheDocument()
    expect(screen.queryByText('Comparing the current Matches filter, applied within each season.')).not.toBeInTheDocument()
  })

  it('re-picks the baseline column from the grouped season list', async () => {
    await renderCompare([
      record({ utc: '2026-03-01T12:00:00Z' }),
      record({ utc: '2026-05-01T12:00:00Z' }),
    ])
    // Chapter optgroups keep both lists navigable as seasons accumulate.
    expect(screen.getAllByRole('group', { name: 'Reign of Talon' })).toHaveLength(2)

    await fireEvent.update(screen.getByLabelText('Baseline (A)'), S2)
    expect(screen.getAllByRole('columnheader', { name: S2 })).toHaveLength(2)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(`Comparing ${S2} versus ${S2}, full seasons.`)).toBeInTheDocument()
  })

  it('narrows both columns to the active Matches filter in filtered scope', async () => {
    seed([
      record({ utc: '2026-03-01T12:00:00Z', hero: 'lucio' }),
      record({ utc: '2026-03-02T12:00:00Z', hero: 'genji' }),
      record({ utc: '2026-05-01T12:00:00Z', hero: 'lucio' }),
    ])
    useMatchesStore().matchesNarrow.pickHero('lucio')
    render(SeasonCompareView, { global: { plugins: [pinia] } })
    await new Promise((r) => setTimeout(r, 0))

    expect(columns('Games')).toEqual(['2', '1', '−1'])
    await fireEvent.click(screen.getByRole('button', { name: 'Current filter' }))
    expect(columns('Games')).toEqual(['1', '1', '0'])
  })

  it('counts season-less matches once and pluralizes the note off that count', async () => {
    // 2015 predates every season window; the record is placeable in time but
    // belongs to no season, so both columns must disown it.
    await renderCompare([
      record({ utc: '2026-03-01T12:00:00Z' }),
      record({ utc: '2015-01-01T12:00:00Z' }),
    ])
    expect(screen.getByText(/1 match doesn't fall in any season/)).toBeInTheDocument()
    expect(screen.getByText(/and is\s+excluded from both columns/)).toBeInTheDocument()
  })

  it('uses the plural voice for more than one season-less match', async () => {
    await renderCompare([
      record({ utc: '2015-01-01T12:00:00Z' }),
      record({ utc: '2015-01-02T12:00:00Z' }),
    ])
    expect(screen.getByText(/2 matches\s+don't fall in any season/)).toBeInTheDocument()
    expect(screen.getByText(/and are\s+excluded from both columns/)).toBeInTheDocument()
  })

  it('never names a hero-less match as the most-played hero', async () => {
    // OCR can miss the hero while still resolving the match; a blank must not
    // win the most-played row over a real pick.
    await renderCompare([
      record({ utc: '2026-03-01T12:00:00Z', hero: '' }),
      record({ utc: '2026-03-02T12:00:00Z', hero: '' }),
      record({ utc: '2026-03-03T12:00:00Z', hero: 'genji' }),
    ])
    expect(columns('Most-played hero')[0]).toBe('Genji')
  })

  it('drops the excluded note entirely when every match landed in a season', async () => {
    await renderCompare([record({ utc: '2026-03-01T12:00:00Z' })])
    expect(screen.queryByText(/fall in any season/)).not.toBeInTheDocument()
  })

  it('hands over to the Form mode, swapping the description and the controls', async () => {
    await renderCompare([record({ utc: '2026-03-01T12:00:00Z' })])
    expect(screen.getByRole('button', { name: 'Seasons' })).toHaveAttribute('aria-pressed', 'true')

    await fireEvent.click(screen.getByRole('button', { name: 'Form' }))
    expect(screen.getByRole('button', { name: 'Form' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Seasons' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText(/Compare this stretch of play against the one before it/)).toBeInTheDocument()
    // The season picker is gone; the Form's own preset group is in its place.
    expect(screen.queryByLabelText('Baseline (A)')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Comparison presets' })).toBeInTheDocument()

    // …and back, with the season picks intact.
    await fireEvent.click(screen.getByRole('button', { name: 'Seasons' }))
    expect(screen.getByLabelText('Baseline (A)')).toHaveValue(S1)
    expect(screen.queryByRole('group', { name: 'Comparison presets' })).not.toBeInTheDocument()
  })
})
