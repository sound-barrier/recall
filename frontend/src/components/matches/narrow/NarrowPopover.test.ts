import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/vue'
import { computed, ref } from 'vue'

import type { MatchRecord } from '@/api-client'
import NarrowPopover from '@/components/matches/narrow/NarrowPopover.vue'
import { createMatchesNarrowState, useMatchesNarrow } from '@/composables/matches/narrow/useMatchesNarrow'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'

// "Narrow this set" is one component in two guises: a modal dialog teleported
// over the workspace (popover) and an always-visible peer column (rail). The
// contract worth pinning is what differs between them — the dialog role, the
// close affordances, the Escape trap, the outside-click dismissal — plus the
// panel's own chrome: the narrowed/total readout, the Reset gate, and the
// facets that only appear once the corpus has values for them.

interface RecOpts {
  map?: string
  hero?: string
  result?: string
  rank?: string
  modifiers?: string[]
  leavers?: string[]
  throwers?: string[]
  tags?: string[]
  queueType?: 'role' | 'open'
}

function annotationOf(o: RecOpts): Record<string, unknown> {
  if (!o.leavers && !o.throwers && !o.tags) return {}
  return { annotation: { leavers: o.leavers ?? [], throwers: o.throwers ?? [], tags: o.tags ?? [] } }
}

function dataOf(o: RecOpts): Record<string, unknown> {
  return {
    map: o.map ?? 'rialto',
    hero: o.hero ?? 'lucio',
    result: o.result ?? 'victory',
    date: '2026-05-10',
    finished_at: '14:00',
    rank: o.rank,
    modifiers: o.modifiers,
  }
}

function rec(key: string, o: RecOpts = {}): MatchRecord {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: dataOf(o),
    ...annotationOf(o),
    ...(o.queueType ? { queue_type: o.queueType } : {}),
  } as unknown as MatchRecord
}

const CORPUS = [
  rec('a', { map: 'rialto', hero: 'lucio' }),
  rec('b', { map: 'numbani', hero: 'mercy', result: 'defeat' }),
  rec('c', { map: 'oasis', hero: 'ana' }),
]

// Same three matches, now carrying the values that unlock the optional facets.
const ENRICHED = [
  rec('a', { rank: 'gold', modifiers: ['reversal'], tags: ['stack'] }),
  rec('b', { map: 'numbani', leavers: ['team'], queueType: 'role' }),
  rec('c', { map: 'oasis', throwers: ['enemy'], queueType: 'open' }),
]

// useModalFocusTrap installs its Escape/Tab handler on `document` and only
// removes it when `open` flips FALSE — a panel unmounted while still open
// leaves the handler behind (reported separately). A stale trap blurs the
// focused field out from under the next test's Escape, so sweep whatever a
// test registered on `document` once that test is done.
const registered: [string, EventListenerOrEventListenerObject, unknown][] = []
const nativeAddEventListener = document.addEventListener
beforeEach(() => {
  document.addEventListener = function (this: Document, type: string, fn: EventListenerOrEventListenerObject, opts?: unknown) {
    registered.push([type, fn, opts])
    nativeAddEventListener.call(this, type, fn, opts as AddEventListenerOptions)
  } as typeof document.addEventListener
})
afterEach(() => {
  document.addEventListener = nativeAddEventListener
  for (const [type, fn, opts] of registered.splice(0)) {
    document.removeEventListener(type, fn, opts as EventListenerOptions)
  }
})

interface SetupOpts {
  open?: boolean
  // Omitted on purpose in most tests: 'popover' is the documented default.
  mode?: 'popover' | 'rail'
  records?: MatchRecord[]
  anchorKey?: string
  triggerEl?: HTMLElement
}

function setup(opts: SetupOpts = {}) {
  seedQuery(qk.system.referenceData, {
    heroes_by_role: {}, maps_by_game_mode: {}, screenshot_sources: [], seasons: [], patches: [], ranks: [],
  })
  const records = opts.records ?? CORPUS
  const anchor = opts.anchorKey ?? ''
  const state = createMatchesNarrowState({ anchorKey: computed(() => anchor) })
  const narrow = useMatchesNarrow(ref(records), state)
  const view = render(NarrowPopover, {
    props: {
      open: opts.open ?? true,
      narrow,
      records,
      ...(opts.mode ? { mode: opts.mode } : {}),
      ...(opts.triggerEl ? { triggerEl: opts.triggerEl } : {}),
    },
  })
  return { ...view, narrow, state }
}

const panel = () => screen.getByRole('dialog', { name: 'Filter matches' })
const rail = () => screen.getByRole('complementary', { name: 'Filter matches' })
const searchBox = () => screen.getByLabelText('Search')
const resetBtn = () => screen.getByRole('button', { name: 'Reset' })

describe('NarrowPopover — popover mode', () => {
  it('renders nothing until the trigger opens it', () => {
    setup({ open: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Search')).not.toBeInTheDocument()
  })

  it('opens as a modal dialog reporting how much of the corpus survives', () => {
    setup({ mode: 'popover' })
    expect(panel()).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('3 / 3 matches')).toBeInTheDocument()
    expect(screen.getByText('3 matches in this view')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close filter panel' })).toBeInTheDocument()
  })

  it('closes from the header X and from Done', async () => {
    const { emitted } = setup()
    await fireEvent.click(screen.getByRole('button', { name: 'Close filter panel' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(emitted('update:open')).toEqual([[false], [false]])
  })

  it('closes on a mousedown outside, but not on one inside the panel', async () => {
    const { emitted } = setup()
    await fireEvent.mouseDown(panel())
    expect(emitted('update:open')).toBeUndefined()

    await fireEvent.mouseDown(document.body)
    expect(emitted('update:open')).toEqual([[false]])
  })

  it('lets Escape out of a text field before it closes the panel', async () => {
    // keepOpenOnFieldEscape: a mid-entry Escape deselects the field (which is
    // what closes an open combo dropdown) instead of losing the whole filter.
    const { emitted } = setup()
    const input = searchBox() as HTMLInputElement
    input.focus()
    await fireEvent.keyDown(document, { key: 'Escape' })
    expect(emitted('update:open')).toBeUndefined()

    // Focus is out of the field now, so the second Escape closes.
    await fireEvent.keyDown(document, { key: 'Escape' })
    expect(emitted('update:open')).toEqual([[false]])
  })

  it('ignores an outside mousedown while it is closed', async () => {
    const { emitted } = setup({ open: false })
    await fireEvent.mouseDown(document.body)
    expect(emitted('update:open')).toBeUndefined()
  })

  it('exempts its own trigger, so the trigger toggle is not fought by the dismisser', async () => {
    // Without the exemption, mousedown-closes-then-click-reopens makes the
    // trigger look dead: the panel would flicker instead of toggling.
    const triggerEl = document.createElement('button')
    document.body.appendChild(triggerEl)
    const { emitted } = setup({ triggerEl })
    await fireEvent.mouseDown(triggerEl)
    expect(emitted('update:open')).toBeUndefined()
    triggerEl.remove()
  })

  it('dismisses when the backdrop scrim is clicked', async () => {
    const { emitted } = setup()
    // eslint-disable-next-line testing-library/no-node-access -- the scrim is aria-hidden decoration teleported to body; it has no accessible handle by design
    const scrim = document.querySelector('.lp-backdrop')
    expect(scrim).not.toBeNull()
    await fireEvent.click(scrim as Element)
    expect(emitted('update:open')).toEqual([[false]])
  })

  it('hands the anchor match up and gets out of the way first', async () => {
    const { emitted } = setup({ anchorKey: 'b' })
    await fireEvent.click(screen.getByRole('button', { name: '↗ open' }))
    // Closing before re-emitting is what puts the detail panel in front.
    expect(emitted('update:open')).toEqual([[false]])
    expect(emitted('open-match')).toEqual([['b']])

    await fireEvent.click(screen.getByRole('button', { name: 'Clear anchor' }))
    expect(emitted('clear-anchor')).toHaveLength(1)
  })

  // The `narrow-open` mirror this used to assert is gone. It existed only to
  // carry the open flag up to the ui store alongside `update:open`, because
  // the store held a SECOND copy of the panel's open-state. There is one copy
  // now — the popover's v-model writes it directly — so the transitions are
  // covered by the `update:open` assertions above and below, and "the shell
  // freezes the background" is pinned in MatchesDossierHead.test.ts against
  // the flag the shell actually reads.
})

describe('NarrowPopover — the / shortcut', () => {
  it('opens the panel from anywhere in the workspace', async () => {
    const { emitted } = setup({ open: false })
    await fireEvent.keyDown(document.body, { key: '/' })
    expect(emitted('update:open')).toEqual([[true]])
  })

  it('stays out of the way while the user is typing', async () => {
    const { emitted } = setup({ open: false })
    const field = document.createElement('input')
    document.body.appendChild(field)
    await fireEvent.keyDown(field, { key: '/' })
    expect(emitted('update:open')).toBeUndefined()
    field.remove()
  })

  it('stays out of the way while the match detail panel is in front', async () => {
    const { emitted } = setup({ open: false })
    const detail = document.createElement('aside')
    detail.className = 'detail-panel'
    document.body.appendChild(detail)
    await fireEvent.keyDown(document.body, { key: '/' })
    expect(emitted('update:open')).toBeUndefined()
    detail.remove()
  })
})

describe('NarrowPopover — rail mode', () => {
  it('stays visible as a peer column even with open=false, and offers no close', () => {
    setup({ mode: 'rail', open: false })
    expect(rail()).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close filter panel' })).not.toBeInTheDocument()
  })

  it('ignores Escape and outside clicks — it is not a modal', async () => {
    const { emitted } = setup({ mode: 'rail' })
    await fireEvent.keyDown(document, { key: 'Escape' })
    await fireEvent.mouseDown(document.body)
    expect(emitted('update:open')).toBeUndefined()
    expect(rail()).toBeInTheDocument()
  })

  it('routes / to the search box instead of an open request', async () => {
    const { emitted } = setup({ mode: 'rail' })
    await fireEvent.keyDown(document.body, { key: '/' })
    expect(emitted('update:open')).toBeUndefined()
    // The focus hop is deferred a macrotask so the panel is laid out first.
    await new Promise((r) => setTimeout(r, 0))
    // eslint-disable-next-line testing-library/no-node-access -- focus placement has no TL query; happy-dom also fails element identity, so compare the id
    expect((document.activeElement as HTMLElement).id).toBe('np-search')
  })

  it('the Maps caret opens its dropdown and closes it again', async () => {
    setup({ mode: 'rail' })
    await fireEvent.click(screen.getByRole('button', { name: 'Open Maps list' }))
    expect(screen.getByRole('listbox', { name: 'Maps' })).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'Close Maps list' }))
    expect(screen.queryByRole('listbox', { name: 'Maps' })).not.toBeInTheDocument()
  })

  it('keeps only one combobox dropdown open at a time', async () => {
    // Map and Hero share a single `comboOpen` slot, so opening one must fold
    // the other away — two stacked listboxes would overlap on the column.
    setup({ mode: 'rail' })
    await fireEvent.click(screen.getByRole('button', { name: 'Open Maps list' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Open Heroes list' }))
    expect(screen.getByRole('listbox', { name: 'Heroes' })).toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: 'Maps' })).not.toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'Close Heroes list' }))
    expect(screen.queryByRole('listbox', { name: 'Heroes' })).not.toBeInTheDocument()
  })

  it('still dismisses an open combobox dropdown on an outside click', async () => {
    setup({ mode: 'rail' })
    await fireEvent.click(screen.getByRole('button', { name: 'Open Maps list' }))
    expect(screen.getByRole('listbox', { name: 'Maps' })).toBeInTheDocument()

    await fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox', { name: 'Maps' })).not.toBeInTheDocument()
    // The panel itself is untouched — only the dropdown closed.
    expect(rail()).toBeInTheDocument()
  })
})

describe('NarrowPopover — narrowing the set', () => {
  it('gates Reset on there being something to reset, and restores the full set', async () => {
    setup()
    expect(resetBtn()).toBeDisabled()

    await fireEvent.click(screen.getByRole('button', { name: 'Open Maps list' }))
    await fireEvent.mouseDown(screen.getByRole('option', { name: /rialto/ }))
    expect(screen.getByText('1 / 3 matches')).toBeInTheDocument()
    expect(resetBtn()).toBeEnabled()

    await fireEvent.click(resetBtn())
    expect(screen.getByText('3 / 3 matches')).toBeInTheDocument()
    expect(resetBtn()).toBeDisabled()
  })

  it('counts a single surviving match in the singular', async () => {
    const { narrow } = setup()
    await fireEvent.update(searchBox(), 'numbani')
    expect(narrow.narrowedRecords.value.map((r) => r.match_key)).toEqual(['b'])
    expect(screen.getByText('1 / 3 matches')).toBeInTheDocument()
    expect(screen.getByText('1 match in this view')).toBeInTheDocument()
  })

  it('offers no empty facet for a dimension the corpus never recorded', () => {
    setup()
    for (const facet of ['Rank', 'Modifiers', 'With a leaver', 'With a thrower']) {
      expect(screen.queryByText(facet)).not.toBeInTheDocument()
    }
  })

  it('surfaces each optional facet as soon as one match carries it', () => {
    setup({ records: ENRICHED })
    for (const facet of ['Rank', 'Modifiers', 'With a leaver', 'With a thrower']) {
      expect(screen.getByText(facet)).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'gold' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'reversal' })).toBeInTheDocument()
    // Tag chips carry the # the user types in the search box.
    expect(screen.getByRole('button', { name: '#stack' })).toBeInTheDocument()
    // The disruption chips read as words, not as the raw enum.
    expect(screen.getByRole('button', { name: 'Teammate' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enemy' })).toBeInTheDocument()
  })

  it('a fixed-enum facet counts its picks and narrows the set', async () => {
    const { narrow } = setup({ records: ENRICHED })
    // Every facet reads "any" until it is used.
    expect(screen.getAllByText('any').length).toBeGreaterThan(0)

    await fireEvent.click(screen.getByRole('button', { name: 'Role Queue' }))
    expect(narrow.narrowedRecords.value.map((r) => r.match_key)).toEqual(['b'])
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })
})
