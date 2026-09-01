import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'

import type { MatchRecord, OWData } from '@/api'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'
import FormCompareView from '@/components/compare/FormCompareView.vue'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'

// FORM mode: two adjacent windows of play → a verdict word + the A/B/Δ
// evidence table, with each cell drillable into the Matches tab only when the
// narrow can reproduce exactly what the cell counted. The clock is frozen so
// the trailing-window presets have a fixed answer; fixture dates are written
// against that frozen "today".

const NOW = new Date(2026, 4, 20, 12, 0, 0) // local midday, so YMD is TZ-stable

function ymd(daysAgo: number): string {
  const d = new Date(NOW)
  d.setDate(d.getDate() - daysAgo)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, '0')}`
}

// Offsets that land inside the default 7d preset windows: B = [today−6, today],
// A = [today−13, today−7].
const IN_B = 2
const IN_A = 9

// Role keys mirror pkg/parser/heroes.yaml (dps / support / tank) — the
// condition + role rows resolve a hero's role through this map.
const OW_DATA: OWData = {
  heroes_by_role: { support: ['Lúcio'], dps: ['Genji'], tank: ['Reinhardt'] },
  maps_by_game_mode: { escort: ['Rialto'] },
  screenshot_sources: [],
  seasons: [], patches: [],
  ranks: [],
}

// Two seasons bracketing the frozen NOW, so the same-point preset is offered.
const IN_SEASON: OWData['seasons'] = [
  { name: 'S1', chapter: 'C', number: 1, start: new Date(2026, 1, 10, 12).toISOString(), end: new Date(2026, 3, 14, 12).toISOString() },
  { name: 'S2', chapter: 'C', number: 2, start: new Date(2026, 3, 14, 12).toISOString(), end: new Date(2026, 5, 16, 12).toISOString() },
]

let seq = 0

interface RecOpts {
  daysAgo?: number
  result?: 'victory' | 'defeat' | 'draw'
  hero?: string
  alsoPlayed?: string
  members?: string[]
  hidden?: boolean
  noMap?: boolean
  changePercent?: number
}

type Role = NonNullable<NonNullable<MatchRecord['data']>['role']>

const ROLE_OF: Record<string, Role> = { genji: 'dps', lucio: 'support', reinhardt: 'tank' }

// A 60/40 split when a second hero is named, so both clear the 5%
// meaningful-play floor and the match counts for both roles.
function heroesPlayed(hero: string, alsoPlayed: string | undefined) {
  const played = [{ hero, percent_played: alsoPlayed ? 60 : 100 }]
  return alsoPlayed ? [...played, { hero: alsoPlayed, percent_played: 40 }] : played
}

function record(opts: RecOpts = {}): MatchRecord {
  seq++
  const { hero = 'lucio', result = 'victory' } = opts
  const date = ymd(opts.daysAgo ?? IN_B)
  const time = `${String(8 + (seq % 12)).padStart(2, '0')}:00`
  return {
    match_key: `match-${date}T${time.replace(':', '-')}-00`,
    source_files: [`${seq}.png`],
    hidden: opts.hidden,
    annotation: opts.members ? { leavers: [], throwers: [], members: opts.members } : undefined,
    data: {
      map: opts.noMap ? undefined : 'rialto',
      game_mode: 'escort',
      playlist: 'competitive',
      role: ROLE_OF[hero],
      hero,
      result,
      date,
      finished_at: time,
      change_percent: opts.changePercent,
      heroes_played: heroesPlayed(hero, opts.alsoPlayed),
    },
    parsed_at: `${date}T23:59:00Z`,
  }
}

function many(n: number, opts: RecOpts): MatchRecord[] {
  return Array.from({ length: n }, () => record(opts))
}

let pinia: Pinia

function seed(records: MatchRecord[], seasons: OWData['seasons'] = []) {
  pinia = createPinia()
  setActivePinia(pinia)
  seedQuery(qk.system.referenceData, { ...OW_DATA, seasons })
  seedQuery(qk.matches, records)
  seedQuery(qk.pendingCount, { count: 0, parked: 0 })
  seedQuery(qk.failedFiles, [])
}

// A before/after pair over two corpora re-renders inside one test, so the
// previous tree has to come down first — TL's own cleanup only runs between
// tests, and a stale tree makes every screen query ambiguous.
let mounted: { unmount: () => void } | null = null

async function renderForm(records: MatchRecord[], seasons: OWData['seasons'] = []) {
  mounted?.unmount()
  seed(records, seasons)
  mounted = render(FormCompareView, { global: { plugins: [pinia] } })
  await new Promise((r) => setTimeout(r, 0))
}

function metricRow(label: string) {
  return screen.getByRole('rowheader', { name: label }).closest('tr')!
}

function columns(label: string): string[] {
  return within(metricRow(label)).getAllByRole('cell').map((c) => c.textContent?.trim() ?? '')
}

function drillButtons(label: string) {
  return within(metricRow(label)).queryAllByRole('button')
}

function verdictWord(): string {
  return screen.getByText(/^(SHARPER|SLIPPING|HOLDING|TOO EARLY TO CALL)$/).textContent!.trim()
}

beforeEach(() => {
  seq = 0
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
})

afterEach(async () => {
  mounted = null
  vi.useRealTimers()
  await vi.dynamicImportSettled()
})

describe('FormCompareView — verdict', () => {
  it('refuses to call a verdict on a thin window and says what would fix it', async () => {
    await renderForm([...many(4, { daysAgo: IN_B }), ...many(6, { daysAgo: IN_A, result: 'defeat' })])
    expect(verdictWord()).toBe('TOO EARLY TO CALL')
    expect(screen.getByText(/Fewer than 5 decisive games in a window/)).toBeInTheDocument()
  })

  it('calls SHARPER with the win-rate mover when this period clearly improved', async () => {
    await renderForm([
      ...many(5, { daysAgo: IN_A, result: 'defeat' }),
      ...many(5, { daysAgo: IN_B, result: 'victory' }),
    ])
    expect(verdictWord()).toBe('SHARPER')
    expect(screen.getByText('Win rate +100 pts')).toBeInTheDocument()
    expect(screen.queryByText(/Fewer than 5 decisive games/)).not.toBeInTheDocument()
  })

  it('calls SLIPPING when the same swing runs the other way', async () => {
    await renderForm([
      ...many(5, { daysAgo: IN_A, result: 'victory' }),
      ...many(5, { daysAgo: IN_B, result: 'defeat' }),
    ])
    expect(verdictWord()).toBe('SLIPPING')
    expect(screen.getByText('Win rate −100 pts')).toBeInTheDocument()
  })

  it('scores rank-meter movement in divisions and lets it headline the verdict', async () => {
    // Win rate is flat (5-1 both sides) but the meter moved +2 divisions this
    // period — the rank mover alone must be enough to call it.
    await renderForm([
      ...many(5, { daysAgo: IN_A, result: 'victory', changePercent: 0 }),
      record({ daysAgo: IN_A, result: 'defeat', changePercent: 0 }),
      ...many(5, { daysAgo: IN_B, result: 'victory', changePercent: 40 }),
      record({ daysAgo: IN_B, result: 'defeat', changePercent: 0 }),
    ])
    expect(columns('Rank progress')).toEqual(['0 div', '+2 div', '▲ 2 div'])
    expect(verdictWord()).toBe('SHARPER')
    expect(screen.getByText('Rank +2 divs')).toBeInTheDocument()
  })

  it('announces the verdict together with the two windows it compared', async () => {
    await renderForm(many(5, { daysAgo: IN_B }))
    expect(screen.getByText(
      new RegExp(`^TOO EARLY TO CALL — comparing This period · ${ymd(6)} – ${ymd(0)} against Previous · ${ymd(13)} – ${ymd(7)}\\.$`),
    )).toBeInTheDocument()
  })
})

describe('FormCompareView — sparklines', () => {
  it('describes each period\'s rolling win-rate line in text, not just pixels', async () => {
    await renderForm([
      ...many(5, { daysAgo: IN_A, result: 'defeat' }),
      ...many(5, { daysAgo: IN_B, result: 'victory' }),
    ])
    expect(screen.getByRole('img', { name: 'Rolling win rate this period: 100% to 100% across 5 decisive games' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Rolling win rate in the baseline window: 0% to 0% across 5 decisive games' })).toBeInTheDocument()
  })

  it('says so plainly when a window holds no decisive game at all', async () => {
    await renderForm(many(3, { daysAgo: IN_B, result: 'draw' }))
    expect(screen.getAllByText('No decisive games')).toHaveLength(2)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

describe('FormCompareView — pairing controls', () => {
  it('keeps exactly one preset pressed as the user moves between them', async () => {
    await renderForm(many(3, { daysAgo: IN_B }))
    const preset = (name: string) => screen.getByRole('button', { name })
    expect(preset('Last 7d vs prior 7d')).toHaveAttribute('aria-pressed', 'true')

    await fireEvent.click(preset('Last 30d vs prior 30d'))
    expect(preset('Last 30d vs prior 30d')).toHaveAttribute('aria-pressed', 'true')
    expect(preset('Last 7d vs prior 7d')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('This period from')).toHaveValue(ymd(29))
  })

  it('swaps the date pickers for a window-size picker in by-matches mode', async () => {
    await renderForm(many(3, { daysAgo: IN_B }))
    await fireEvent.click(screen.getByRole('button', { name: 'Last 20 vs prior 20' }))
    expect(screen.getByRole('button', { name: 'By matches' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByLabelText('This period from')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Window size')).toHaveValue('20')
    expect(screen.getByRole('columnheader', { name: 'Last 20' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Prior 20' })).toBeInTheDocument()
  })

  it('re-clicking the active pairing mode leaves the preset highlight alone', async () => {
    await renderForm(many(3, { daysAgo: IN_B }))
    await fireEvent.click(screen.getByRole('button', { name: 'By time' }))
    expect(screen.getByRole('button', { name: 'Last 7d vs prior 7d' })).toHaveAttribute('aria-pressed', 'true')

    await fireEvent.click(screen.getByRole('button', { name: 'By matches' }))
    expect(screen.getByRole('button', { name: 'Last 20 vs prior 20' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('unlocking the baseline exposes its own dates and warns when the windows differ in length', async () => {
    await renderForm(many(3, { daysAgo: IN_B }))
    expect(screen.getByText(/vs previous period/)).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'Unlock baseline' }))
    expect(screen.queryByText(/vs previous period/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mirror previous period' })).toBeInTheDocument()

    await fireEvent.update(screen.getByLabelText('Baseline from'), ymd(40))
    await fireEvent.update(screen.getByLabelText('Baseline to'), ymd(20))
    expect(screen.getByText(/Unequal windows/)).toBeInTheDocument()

    // Same length as the 7-day B window → the caveat retires.
    await fireEvent.update(screen.getByLabelText('Baseline from'), ymd(26))
    expect(screen.queryByText(/Unequal windows/)).not.toBeInTheDocument()
  })

  it('drops the preset highlight once a window date is edited by hand', async () => {
    await renderForm(many(3, { daysAgo: IN_B }))
    const from = screen.getByLabelText('This period from')
    await fireEvent.update(from, ymd(3))
    await fireEvent.change(from)
    for (const name of ['Last 7d vs prior 7d', 'Last 30d vs prior 30d', 'Last 20 vs prior 20']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false')
    }
    // The baseline still mirrors — a hand-edited B re-derives A's 4-day window.
    expect(screen.getByText(`vs previous period · ${ymd(7)} – ${ymd(4)}`)).toBeInTheDocument()

    // Re-picking a preset re-lights it and restores its window.
    await fireEvent.click(screen.getByRole('button', { name: 'Last 7d vs prior 7d' }))
    expect(screen.getByRole('button', { name: 'Last 7d vs prior 7d' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('This period from')).toHaveValue(ymd(6))

    // Every date control carries the same rule, not just the first one.
    const to = screen.getByLabelText('This period to')
    await fireEvent.update(to, ymd(1))
    await fireEvent.change(to)
    expect(screen.getByRole('button', { name: 'Last 7d vs prior 7d' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('drops the highlight when a baseline date is edited under the same-point preset', async () => {
    await renderForm(many(3, { daysAgo: IN_B }), IN_SEASON)
    await fireEvent.click(screen.getByRole('button', { name: 'Same point last season' }))
    expect(screen.getByRole('button', { name: 'Same point last season' })).toHaveAttribute('aria-pressed', 'true')

    const baselineTo = screen.getByLabelText('Baseline to')
    await fireEvent.update(baselineTo, '2026-03-10')
    await fireEvent.change(baselineTo)
    expect(screen.getByRole('button', { name: 'Same point last season' })).toHaveAttribute('aria-pressed', 'false')

    const baselineFrom = screen.getByLabelText('Baseline from')
    await fireEvent.click(screen.getByRole('button', { name: 'Same point last season' }))
    await fireEvent.update(baselineFrom, '2026-02-20')
    await fireEvent.change(baselineFrom)
    expect(screen.getByRole('button', { name: 'Same point last season' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('offers same-point-last-season only when today sits in a season with a predecessor', async () => {
    await renderForm(many(3, { daysAgo: IN_B }))
    expect(screen.queryByRole('button', { name: 'Same point last season' })).not.toBeInTheDocument()

    await renderForm(many(3, { daysAgo: IN_B }), IN_SEASON)
    await fireEvent.click(screen.getByRole('button', { name: 'Same point last season' }))
    // The preset unlocks the baseline and truncates last season to the elapsed days.
    expect(screen.getByLabelText('Baseline from')).toHaveValue('2026-02-10')
    expect(screen.getByLabelText('Baseline to')).toHaveValue('2026-03-18')
    expect(screen.getByLabelText('This period from')).toHaveValue('2026-04-14')
  })
})

describe('FormCompareView — conditions', () => {
  it('reveals the member picker only for the duo condition and applies the pick', async () => {
    await renderForm([
      ...many(2, { daysAgo: IN_B, members: ['Ratbag'] }),
      ...many(3, { daysAgo: IN_B }),
    ])
    expect(columns('Games')[1]).toBe('5')
    expect(screen.queryByLabelText("This period's duo member")).not.toBeInTheDocument()

    await fireEvent.update(screen.getByLabelText("This period's condition"), 'member')
    const picker = screen.getByLabelText("This period's duo member")
    // An unfilled sub-pick must not filter everything out — it degrades to "any".
    expect(columns('Games')[1]).toBe('5')

    await fireEvent.update(picker, 'Ratbag')
    expect(columns('Games')[1]).toBe('2')
  })

  it('filters a column by hero using the display name in the picker', async () => {
    await renderForm([
      ...many(2, { daysAgo: IN_B, hero: 'genji' }),
      ...many(3, { daysAgo: IN_B, hero: 'lucio' }),
    ])
    await fireEvent.update(screen.getByLabelText("This period's condition"), 'hero')
    expect(screen.getByRole('option', { name: 'Genji' })).toBeInTheDocument()
    await fireEvent.update(screen.getByLabelText("This period's hero"), 'genji')
    expect(columns('Games')[1]).toBe('2')
  })

  it('keeps the two columns\' conditions independent', async () => {
    await renderForm([
      ...many(2, { daysAgo: IN_A, hero: 'genji' }),
      ...many(3, { daysAgo: IN_A, hero: 'lucio' }),
      ...many(4, { daysAgo: IN_B, hero: 'lucio' }),
    ])
    expect(columns('Games')).toEqual(['5', '4', '−1'])

    // The baseline picker moves column A and leaves B where it was.
    await fireEvent.update(screen.getByLabelText('Baseline condition'), 'hero')
    await fireEvent.update(screen.getByLabelText('Baseline hero'), 'genji')
    expect(screen.queryByLabelText("This period's hero")).not.toBeInTheDocument()
    expect(columns('Games')).toEqual(['2', '4', '+2'])
  })

  it('applies a role condition to one column only', async () => {
    await renderForm([
      ...many(2, { daysAgo: IN_B, hero: 'genji' }),
      ...many(3, { daysAgo: IN_B, hero: 'lucio' }),
      ...many(4, { daysAgo: IN_A, hero: 'lucio' }),
    ])
    await fireEvent.update(screen.getByLabelText("This period's condition"), 'role:dps')
    expect(columns('Games')).toEqual(['4', '2', '−2'])
  })
})

describe('FormCompareView — notes', () => {
  it('reports records with no derivable date, in the right voice for the count', async () => {
    const undated = (): MatchRecord => ({
      match_key: `unmatched-${++seq}`,
      source_files: [`${seq}.png`],
      data: { map: 'rialto', result: 'victory' },
      parsed_at: '2026-05-20T00:00:00Z',
    })
    await renderForm([record({ daysAgo: IN_B }), undated()])
    expect(screen.getByText(/1 match without a derivable date\s+is excluded from both windows\./)).toBeInTheDocument()

    await renderForm([record({ daysAgo: IN_B }), undated(), undated()])
    expect(screen.getByText(/2 matches without a derivable date\s+are excluded from both windows\./)).toBeInTheDocument()
  })

  it('caveats a thin win rate and drops the caveat once both windows are solid', async () => {
    await renderForm([
      ...many(2, { daysAgo: IN_A, result: 'victory' }),
      ...many(2, { daysAgo: IN_B, result: 'defeat' }),
    ])
    expect(screen.getByText(/marks a window with fewer than five decisive/)).toBeInTheDocument()

    await renderForm([
      ...many(6, { daysAgo: IN_A, result: 'victory' }),
      ...many(6, { daysAgo: IN_B, result: 'defeat' }),
    ])
    expect(screen.queryByText(/marks a window with fewer than five decisive/)).not.toBeInTheDocument()
  })

  it('excludes hidden and unknown-map records from both windows', async () => {
    await renderForm([
      ...many(3, { daysAgo: IN_B }),
      record({ daysAgo: IN_B, hidden: true }),
      record({ daysAgo: IN_B, noMap: true }),
    ])
    expect(columns('Games')[1]).toBe('3')
  })

  it('never names a hero-less match as the most-played hero', async () => {
    // OCR can miss the hero while still resolving the match; a blank must not
    // win the most-played row over a real pick.
    await renderForm([
      record({ daysAgo: IN_B, hero: '' }),
      record({ daysAgo: IN_B, hero: '' }),
      record({ daysAgo: IN_B, hero: 'genji' }),
    ])
    expect(columns('Most-played hero')[1]).toBe('Genji')
  })
})

describe('FormCompareView — drill-through', () => {
  it('sends the clicked cell\'s window and dimension to the Matches narrow', async () => {
    await renderForm([
      ...many(3, { daysAgo: IN_A, hero: 'genji' }),
      ...many(2, { daysAgo: IN_B, hero: 'genji' }),
    ])
    const cell = drillButtons('DPS win rate')[1]!
    expect(cell).toHaveAttribute('aria-label', expect.stringContaining('Show matches — DPS win rate'))
    await fireEvent.click(cell)

    const narrow = useMatchesStore().matchesNarrow
    expect(narrow.pickedRange.value).toBe('custom')
    expect(narrow.customFrom.value).toBe(ymd(6))
    expect(narrow.customTo.value).toBe(ymd(0))
    expect([...narrow.pickedRoles.value]).toEqual(['dps'])
    expect(useAppStore().view).toBe('matches')
  })

  it('leaves rows the narrow cannot express as inert text', async () => {
    await renderForm(many(6, { daysAgo: IN_B }))
    // No per-match hero-count clause exists, so a window-only drill would
    // contradict the cell's count.
    expect(drillButtons('Hero pool')).toHaveLength(0)
    expect(drillButtons('Single-hero games')).toHaveLength(0)
    expect(drillButtons('Games')).toHaveLength(2) // both columns
  })

  it('withdraws the drill from the column whose condition has no narrow equivalent', async () => {
    await renderForm(many(6, { daysAgo: IN_B }))
    expect(drillButtons('Games')).toHaveLength(2)
    // "Solo (no group)" has no narrow clause — only that column goes inert.
    await fireEvent.update(screen.getByLabelText("This period's condition"), 'solo')
    const remaining = drillButtons('Games')
    expect(remaining).toHaveLength(1)
    expect(remaining[0]).toHaveAttribute('aria-label', expect.stringContaining('Previous ·'))
  })

  it('withdraws a role row\'s drill under a conflicting role condition', async () => {
    // Every match touched BOTH roles, so the DPS row still shows a rate under a
    // Support condition — the cell is suppressed for expressibility, not
    // because it has nothing to show.
    await renderForm([
      ...many(4, { daysAgo: IN_A, hero: 'lucio', alsoPlayed: 'genji' }),
      ...many(4, { daysAgo: IN_B, hero: 'lucio', alsoPlayed: 'genji' }),
    ])
    expect(drillButtons('DPS win rate')).toHaveLength(2)

    await fireEvent.update(screen.getByLabelText("This period's condition"), 'role:support')
    expect(columns('DPS win rate')[1]).not.toBe('—')
    // Role picks OR together in the narrow, so "DPS games among Support games"
    // widens instead of intersecting — the matching row is still exact.
    expect(drillButtons('DPS win rate')).toHaveLength(1)
    expect(drillButtons('Support win rate')).toHaveLength(2)
  })

  it('withdraws the drill in by-matches mode when the derived window is not exact', async () => {
    // A count window drills as its first/last match DATES. With 21 matches on
    // 21 distinct days that mapping is lossless, so both columns drill.
    const distinct = Array.from({ length: 21 }, (_, i) => record({ daysAgo: 21 - i }))
    const byMatchesOfTen = async () => {
      await fireEvent.click(screen.getByRole('button', { name: 'Last 20 vs prior 20' }))
      await fireEvent.update(screen.getByLabelText('Window size'), '10')
    }
    await renderForm(distinct)
    await byMatchesOfTen()
    expect(drillButtons('Games')).toHaveLength(2)

    // A second match on the baseline's oldest day is outside the COUNT window
    // but inside the date window it derives — so column A can no longer be
    // reproduced by a drill and goes inert, while B is untouched.
    await renderForm([...distinct, record({ daysAgo: 20 })])
    await byMatchesOfTen()
    const remaining = drillButtons('Games')
    expect(remaining).toHaveLength(1)
    expect(remaining[0]).toHaveAttribute('aria-label', expect.stringContaining('Last 10'))
  })
})
