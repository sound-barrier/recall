import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useCardFocus } from '@/composables/shared/useCardFocus'

// The Matches list as the composable sees it: a `.leaves-list` of
// `.leaf-row[data-card-index]` <li>s, optionally split by
// `.section-divider`s when the list is grouped (Y/M/W/D). The
// data-card-index values are narrowedRecords positions, which need NOT
// match render order — that mismatch is the whole reason the walk is
// driven off the DOM (Sort = Oldest renders the set backwards).
type ListItem = number | 'divider'

function buildList(items: ListItem[]) {
  const list = document.createElement('ul')
  list.className = 'leaves-list'
  for (const item of items) {
    const li = document.createElement('li')
    if (item === 'divider') {
      li.className = 'section-divider'
    } else {
      li.className = 'leaf-row'
      li.tabIndex = -1
      li.id = `row-${item}`
      li.dataset.cardIndex = String(item)
    }
    list.appendChild(li)
  }
  document.body.appendChild(list)
}

// happy-dom's activeElement fails identity compares (documented gotcha),
// so the focused row is read back by id.
const focusedRowId = () => document.activeElement?.id

beforeEach(() => { document.body.innerHTML = '' })
afterEach(() => { document.body.innerHTML = '' })

describe('useCardFocus — j/k walk', () => {
  it('first j lands on the first rendered row and moves DOM focus there', async () => {
    buildList([4, 5, 6])
    const focus = useCardFocus()
    await focus.focusCardByRenderedDelta(1)

    expect(focus.focusedCardIndex.value).toBe(4)
    expect(focusedRowId()).toBe('row-4')
  })

  it('first k also lands on the first rendered row (nothing focused yet)', async () => {
    buildList([4, 5, 6])
    const focus = useCardFocus()
    await focus.focusCardByRenderedDelta(-1)

    expect(focus.focusedCardIndex.value).toBe(4)
  })

  it('follows RENDERED order, not narrowedRecords order', async () => {
    // Sort = Oldest: the list renders indices descending. j must step to
    // the next VISIBLE row (2), never to index+1 (8, which is above it).
    buildList([7, 2, 5])
    const focus = useCardFocus()
    await focus.focusCardByRenderedDelta(1)
    expect(focus.focusedCardIndex.value).toBe(7)

    await focus.focusCardByRenderedDelta(1)
    expect(focus.focusedCardIndex.value).toBe(2)
    expect(focusedRowId()).toBe('row-2')

    await focus.focusCardByRenderedDelta(-1)
    expect(focus.focusedCardIndex.value).toBe(7)
  })

  it('does not wrap at either end of the list', async () => {
    buildList([0, 1])
    const focus = useCardFocus()
    await focus.focusCardByRenderedEnd('last')
    expect(focus.focusedCardIndex.value).toBe(1)

    await focus.focusCardByRenderedDelta(1) // j past the end
    expect(focus.focusedCardIndex.value).toBe(1)

    await focus.focusCardByRenderedDelta(-1)
    await focus.focusCardByRenderedDelta(-1) // k past the start
    expect(focus.focusedCardIndex.value).toBe(0)
  })

  it('is a no-op on an empty list (narrowed to zero matches)', async () => {
    buildList([])
    const focus = useCardFocus()
    await focus.focusCardByRenderedDelta(1)
    await focus.focusCardByRenderedEnd('last')

    expect(focus.focusedCardIndex.value).toBe(-1)
    expect(focusedRowId()).not.toBe('row-0')
  })

  it('gg / G jump to the first and last rendered rows', async () => {
    buildList([9, 3, 1])
    const focus = useCardFocus()
    await focus.focusCardByRenderedEnd('last')
    expect(focus.focusedCardIndex.value).toBe(1)
    expect(focusedRowId()).toBe('row-1')

    await focus.focusCardByRenderedEnd('first')
    expect(focus.focusedCardIndex.value).toBe(9)
    expect(focusedRowId()).toBe('row-9')
  })
})

describe('useCardFocus — n/N section walk', () => {
  // Three grouped sections: [0,1] [2] [3,4].
  const grouped: ListItem[] = ['divider', 0, 1, 'divider', 2, 'divider', 3, 4]

  it('first n lands on the first section, first N on the last', async () => {
    buildList(grouped)
    const forward = useCardFocus()
    await forward.focusSectionByRenderedDelta(1)
    expect(forward.focusedCardIndex.value).toBe(0)

    document.body.innerHTML = ''
    buildList(grouped)
    const backward = useCardFocus()
    await backward.focusSectionByRenderedDelta(-1)
    expect(backward.focusedCardIndex.value).toBe(3)
  })

  it('n from mid-section jumps to the NEXT section head, not the next row', async () => {
    buildList(grouped)
    const focus = useCardFocus()
    await focus.focusCardByRenderedDelta(1) // row 0, inside section one
    await focus.focusCardByRenderedDelta(1) // row 1, still section one

    await focus.focusSectionByRenderedDelta(1)
    expect(focus.focusedCardIndex.value).toBe(2)
    expect(focusedRowId()).toBe('row-2')
  })

  it('N from a section head goes back to the previous section head', async () => {
    buildList(grouped)
    const focus = useCardFocus()
    await focus.focusCardByRenderedEnd('last') // row 4, last section
    await focus.focusSectionByRenderedDelta(-1)
    expect(focus.focusedCardIndex.value).toBe(2)

    await focus.focusSectionByRenderedDelta(-1)
    expect(focus.focusedCardIndex.value).toBe(0)
    // Clamped: no wrap past the first section.
    await focus.focusSectionByRenderedDelta(-1)
    expect(focus.focusedCardIndex.value).toBe(0)
  })

  it('is a no-op when the list is ungrouped (one section)', async () => {
    buildList([0, 1, 2])
    const focus = useCardFocus()
    await focus.focusCardByRenderedDelta(1)
    await focus.focusSectionByRenderedDelta(1)

    expect(focus.focusedCardIndex.value).toBe(0)
  })

  it('does not mistake a virtualization spacer for a section boundary', async () => {
    // Flat-mode virtualization inserts `.leaves-virtual-spacer` <li>s as
    // siblings of the rows. They are neither divider nor row: the first
    // real row after a leading spacer must still register as section one's
    // head, or n/N would skip the top of the list.
    const list = document.createElement('ul')
    list.className = 'leaves-list'
    for (const item of ['spacer', 0, 'divider', 1] as const) {
      const li = document.createElement('li')
      if (item === 'spacer') li.className = 'leaves-virtual-spacer'
      else if (item === 'divider') li.className = 'section-divider'
      else {
        li.className = 'leaf-row'
        li.tabIndex = -1
        li.id = `row-${item}`
        li.dataset.cardIndex = String(item)
      }
      list.appendChild(li)
    }
    document.body.appendChild(list)

    const focus = useCardFocus()
    await focus.focusSectionByRenderedDelta(1)
    expect(focus.focusedCardIndex.value).toBe(0)
  })

  it('recovers when the focused row has been virtualized out of the DOM', async () => {
    buildList(grouped)
    const focus = useCardFocus()
    focus.focusedCardIndex.value = 99 // scrolled far out of the rendered window
    await focus.focusSectionByRenderedDelta(1)

    // No anchor can be located relative to a missing row, so n behaves like
    // a first press instead of silently doing nothing.
    expect(focus.focusedCardIndex.value).toBe(0)
  })

  it('does nothing when no leaf list is rendered', async () => {
    // Data density renders a <table> instead of `.leaves-list`.
    const focus = useCardFocus()
    await focus.focusSectionByRenderedDelta(1)

    expect(focus.focusedCardIndex.value).toBe(-1)
  })
})

// Data density renders the same rows as a <table> of `tr.table-row`
// instead of `li.leaf-row` (MatchTableRow.vue). Both carry the same
// data-card-index contract, and the keyboard motions are documented as
// working in both densities — so the walk must not be spelled against
// one row class.
function buildTable(indices: number[]) {
  const table = document.createElement('table')
  const body = document.createElement('tbody')
  for (const idx of indices) {
    const row = document.createElement('tr')
    row.className = 'table-row'
    row.tabIndex = -1
    row.id = `row-${idx}`
    row.dataset.cardIndex = String(idx)
    body.appendChild(row)
  }
  table.appendChild(body)
  document.body.appendChild(table)
}

describe('useCardFocus — Data density (table rows)', () => {
  it('j walks the table rows the same way it walks leaf rows', async () => {
    buildTable([4, 5, 6])
    const focus = useCardFocus()

    await focus.focusCardByRenderedDelta(1)
    expect(focus.focusedCardIndex.value).toBe(4)
    expect(focusedRowId()).toBe('row-4')

    await focus.focusCardByRenderedDelta(1)
    expect(focus.focusedCardIndex.value).toBe(5)
    expect(focusedRowId()).toBe('row-5')
  })

  it('G jumps to the last table row', async () => {
    buildTable([4, 5, 6])
    const focus = useCardFocus()
    await focus.focusCardByRenderedEnd('last')

    expect(focus.focusedCardIndex.value).toBe(6)
    expect(focusedRowId()).toBe('row-6')
  })
})
