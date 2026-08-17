import { describe, expect, it } from 'vitest'
import { computed, nextTick, ref } from 'vue'
import { fireEvent, render, screen, within } from '@testing-library/vue'

import MatchesDossier from '@/components/matches/dossier/MatchesDossier.vue'
import {
  createMatchesNarrowState,
  useMatchesNarrow,
} from '@/composables/matches/narrow/useMatchesNarrow'
import type { MatchRecord } from '@/api-client'

// The dossier head's active-clause chip row: one chip per narrowing
// clause the user has on, each with an × that drops exactly that clause.
// The chips mutate the real narrow bundle's refs, so these tests wire the
// production composable (not a stub) and assert on what the chip row does
// to it — a chip whose × dropped the wrong dimension would pass a
// props-only test and lose the user's whole filter here.

type Narrow = ReturnType<typeof useMatchesNarrow>

// The record the "since this match" chip names.
const ANCHOR: MatchRecord = { match_key: 'match-1', source_files: ['a.png'], data: { map: 'rialto', date: '2026-05-10' } }

interface SetupOptions {
  anchorKey?: string
  anchorRecord?: MatchRecord | null
  anchorChipLabel?: string
}

// Builds a real narrow bundle, lets the caller seed clauses BEFORE the
// first render (so the initial chip row is the seeded one), then mounts.
function setup(seed: (narrow: Narrow) => void = () => {}, opts: SetupOptions = {}): Narrow {
  const records = ref<MatchRecord[]>([])
  const anchorKey = computed(() => opts.anchorKey ?? '')
  const narrow = useMatchesNarrow(records, createMatchesNarrowState({ anchorKey }))
  seed(narrow)
  render(MatchesDossier, {
    props: {
      narrow,
      setHeadline: 'All matches on record',
      setSubline: 'spans your full history',
      anchorRecord: opts.anchorRecord ?? null,
      anchorChipLabel: opts.anchorChipLabel ?? '',
    },
  })
  return narrow
}

const chipRow = () => screen.getByRole('list', { name: 'Active narrowing clauses' })
const noChipRow = () => screen.queryByRole('list', { name: 'Active narrowing clauses' })
// Accessible name of every chip control, in render order — the chip row's
// contract is "one drop control per active clause, in display order".
const chipControlNames = () =>
  within(chipRow())
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '')

describe('MatchesDossier — chip row visibility', () => {
  it('reads "Set" with no clauses and renders no chip row at all', () => {
    setup()
    expect(screen.getByText('Set')).toBeInTheDocument()
    expect(screen.queryByText('Narrowed set')).not.toBeInTheDocument()
    expect(noChipRow()).not.toBeInTheDocument()
  })

  it('flips the eyebrow to "Narrowed set" once a clause is active', async () => {
    const narrow = setup()
    narrow.pickMap('rialto')
    await nextTick()
    expect(screen.getByText('Narrowed set')).toBeInTheDocument()
    expect(screen.queryByText('Set')).not.toBeInTheDocument()
  })

  it('renders the headline and subline it is handed', () => {
    setup()
    expect(screen.getByRole('heading', { name: 'All matches on record' })).toBeInTheDocument()
    expect(screen.getByText('spans your full history')).toBeInTheDocument()
  })
})

describe('MatchesDossier — one chip per active clause, in display order', () => {
  it('lists every dimension once, ending with Clear all', () => {
    setup((n) => {
      n.searchText.value = '  ana  '
      n.customFrom.value = '2026-05-01'
      n.customTo.value = '2026-05-31'
      n.pickMap('rialto')
      n.pickGameMode('control')
      n.pickHero('lucio')
      n.pickRole('support')
      n.pickResult('victory')
      n.pickTag('smurf')
      n.pickMember('jax')
      n.leaverHandling.value = 'hide'
      n.minPlayMinutes.value = 5
      n.minPlayPercent.value = 40
      n.includeUnknown.value = true
      n.pickReviewedBy('coach')
      n.pickSource('manual')
      n.sinceAnchorActive.value = true
    }, { anchorKey: 'match-1', anchorRecord: ANCHOR, anchorChipLabel: '2026-05-10 · rialto' })

    expect(chipControlNames()).toEqual([
      'Clear search',
      'Clear dates',
      'Drop map rialto',
      'Drop type control',
      'Drop hero lucio',
      'Drop role support',
      'Drop result victory',
      'Drop tag smurf',
      'Drop teammate jax',
      'Reset leavers',
      'Reset min play minutes',
      'Reset min play percent',
      'Hide unknown',
      'Drop coach',
      'Drop user entered',
      'Stop filtering since anchor',
      'Clear all',
    ])
  })

  it('shows the trimmed search term, the formatted dates, and the # on a tag', () => {
    setup((n) => {
      n.searchText.value = '  ana  '
      n.customFrom.value = '2026-05-01'
      n.customFromTime.value = '18:30'
      n.pickTag('smurf')
    })
    expect(screen.getByText('"ana"')).toBeInTheDocument()
    // An unset side of the range renders as '…', and a time bound tightens
    // the day it is attached to.
    expect(screen.getByText('2026-05-01 18:30 → …')).toBeInTheDocument()
    expect(screen.getByText('#smurf')).toBeInTheDocument()
  })
})

describe('MatchesDossier — date clause chips are mutually exclusive', () => {
  it('shows only the Dates chip when a custom range is set alongside a preset', () => {
    setup((n) => {
      n.pickedRange.value = '30d'
      n.customFrom.value = '2026-05-01'
    })
    expect(screen.getByRole('button', { name: 'Clear dates' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Drop range' })).not.toBeInTheDocument()
  })

  it('shows the preset chip only while no custom bound exists', () => {
    setup((n) => { n.pickedRange.value = '7d' })
    expect(screen.getByText('last 7d')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear dates' })).not.toBeInTheDocument()
  })

  it('Clear dates resets the range to "all" and drops both bounds', async () => {
    const narrow = setup((n) => {
      n.pickedRange.value = 'custom'
      n.customFrom.value = '2026-05-01'
      n.customTo.value = '2026-05-31'
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Clear dates' }))
    expect(narrow.pickedRange.value).toBe('all')
    expect(narrow.customFrom.value).toBe('')
    expect(narrow.customTo.value).toBe('')
    expect(noChipRow()).not.toBeInTheDocument()
  })
})

describe('MatchesDossier — dropping one clause leaves the rest alone', () => {
  it('a map ×  removes only that map', async () => {
    const narrow = setup((n) => {
      n.pickMap('rialto')
      n.pickMap('havana')
      n.pickHero('lucio')
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Drop map havana' }))
    expect([...narrow.pickedMaps.value]).toEqual(['rialto'])
    expect(narrow.pickedHeroes.value.has('lucio')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Drop map havana' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Drop map rialto' })).toBeInTheDocument()
  })

  // Every chip is a near-copy of its neighbor, so the wire most likely to
  // rot is a × calling the WRONG dimension's picker. Drive each one and
  // assert its own dimension — and only its own — went empty.
  it('every chip × drops exactly the dimension it names', async () => {
    const narrow = setup((n) => {
      n.pickGameMode('control')
      n.pickHero('lucio')
      n.pickRole('support')
      n.pickResult('victory')
      n.pickTag('smurf')
      n.pickMember('jax')
      n.pickReviewedBy('coach')
      n.pickSource('ocr_edited')
      n.minPlayPercent.value = 40
      n.pickedRange.value = '7d'
    })
    const drops: [string, () => boolean][] = [
      ['Drop type control',   () => narrow.pickedGameModes.value.size === 0],
      ['Drop hero lucio',     () => narrow.pickedHeroes.value.size === 0],
      ['Drop role support',   () => narrow.pickedRoles.value.size === 0],
      ['Drop result victory', () => narrow.pickedResults.value.size === 0],
      ['Drop tag smurf',      () => narrow.pickedTags.value.size === 0],
      ['Drop teammate jax',   () => narrow.pickedMembers.value.size === 0],
      ['Drop coach',          () => narrow.pickedReviewedBy.value.size === 0],
      ['Drop edited',         () => narrow.pickedSources.value.size === 0],
      ['Reset min play percent', () => narrow.minPlayPercent.value === 0],
      ['Drop range',          () => narrow.pickedRange.value === 'all'],
    ]
    for (const [name, dropped] of drops) {
      expect(dropped()).toBe(false)
      await fireEvent.click(screen.getByRole('button', { name }))
      expect(dropped()).toBe(true)
    }
    expect(narrow.anyNarrow.value).toBe(false)
  })

  it('Clear search empties the term without touching the picked sets', async () => {
    const narrow = setup((n) => {
      n.searchText.value = 'ana'
      n.pickRole('support')
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(narrow.searchText.value).toBe('')
    expect(narrow.pickedRoles.value.has('support')).toBe(true)
  })

  it('the two min-play thresholds reset independently', async () => {
    const narrow = setup((n) => {
      n.minPlayMinutes.value = 5
      n.minPlayPercent.value = 40
    })
    expect(screen.getByText('≥ 5m')).toBeInTheDocument()
    expect(screen.getByText('≥ 40%')).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'Reset min play minutes' }))
    expect(narrow.minPlayMinutes.value).toBe(0)
    expect(narrow.minPlayPercent.value).toBe(40)
    expect(screen.queryByText('≥ 5m')).not.toBeInTheDocument()
    expect(screen.getByText('≥ 40%')).toBeInTheDocument()
  })

  it('a zero threshold contributes no chip (the 0/1 boundary)', () => {
    setup((n) => {
      n.minPlayMinutes.value = 0
      n.minPlayPercent.value = 1
    })
    expect(screen.queryByRole('button', { name: 'Reset min play minutes' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset min play percent' })).toBeInTheDocument()
  })
})

describe('MatchesDossier — clause wording', () => {
  it('spells out each leaver-handling mode and resets to include', async () => {
    const narrow = setup((n) => { n.leaverHandling.value = 'exclude-tally' })
    expect(screen.getByText('no tally')).toBeInTheDocument()

    narrow.leaverHandling.value = 'hide'
    await nextTick()
    expect(screen.getByText('hidden')).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'Reset leavers' }))
    expect(narrow.leaverHandling.value).toBe('include')
    expect(noChipRow()).not.toBeInTheDocument()
  })

  it('translates the provenance enum into user wording on both the chip and its ×', () => {
    setup((n) => {
      n.pickSource('manual')
      n.pickSource('ocr_edited')
    })
    expect(screen.getByText('user entered')).toBeInTheDocument()
    expect(screen.getByText('edited')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Drop user entered' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Drop edited' })).toBeInTheDocument()
  })

  it('Hide unknown flips includeUnknown back off', async () => {
    const narrow = setup((n) => { n.includeUnknown.value = true })
    expect(screen.getByText('shown')).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'Hide unknown' }))
    expect(narrow.includeUnknown.value).toBe(false)
  })
})

describe('MatchesDossier — since-anchor chip', () => {
  
  it('renders the anchor label when the flag AND a resolvable record are both present', () => {
    setup((n) => { n.sinceAnchorActive.value = true }, {
      anchorKey: 'match-1', anchorRecord: ANCHOR, anchorChipLabel: '2026-05-10 · rialto',
    })
    expect(screen.getByText('2026-05-10 · rialto')).toBeInTheDocument()
  })

  it('stays hidden when the anchored match has been deleted (no record to name)', () => {
    setup((n) => {
      n.sinceAnchorActive.value = true
      n.pickMap('rialto')
    }, { anchorKey: 'match-gone', anchorRecord: null, anchorChipLabel: '' })
    expect(screen.getByRole('button', { name: 'Drop map rialto' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop filtering since anchor' })).not.toBeInTheDocument()
  })

  it('its × turns the filter off but leaves the anchor itself set', async () => {
    const narrow = setup((n) => { n.sinceAnchorActive.value = true }, {
      anchorKey: 'match-1', anchorRecord: ANCHOR, anchorChipLabel: '2026-05-10 · rialto',
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Stop filtering since anchor' }))
    expect(narrow.sinceAnchorActive.value).toBe(false)
    expect(narrow.anchorKey.value).toBe('match-1')
  })
})

describe('MatchesDossier — Clear all', () => {
  it('drops every clause in one click and collapses the chip row', async () => {
    const narrow = setup((n) => {
      n.searchText.value = 'ana'
      n.pickMap('rialto')
      n.pickHero('lucio')
      n.customFrom.value = '2026-05-01'
      n.leaverHandling.value = 'hide'
      n.includeUnknown.value = true
      n.sinceAnchorActive.value = true
    }, { anchorKey: 'match-1', anchorRecord: ANCHOR })

    await fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))

    expect(narrow.anyNarrow.value).toBe(false)
    expect(noChipRow()).not.toBeInTheDocument()
    // The anchor survives a narrow reset — only the filter using it is off.
    expect(narrow.anchorKey.value).toBe('match-1')
    expect(narrow.sinceAnchorActive.value).toBe(false)
  })
})
