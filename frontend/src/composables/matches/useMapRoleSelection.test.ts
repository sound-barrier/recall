import { describe, expect, it } from 'vitest'
import { useMapRoleSelection, type MapRoleSelectionOptions } from '@/composables/matches/useMapRoleSelection'

// Grid fixture: 4 maps × 3 roles. By default every cell is selectable; pass an
// `unselectable` set (`map|role`) to model never-played (inert) cells.
const COLS = ['kings-row', 'ilios', 'oasis', 'nepal']
const ROLES = ['tank', 'dps', 'support']

function make(unselectable: string[] = []) {
  const inert = new Set(unselectable)
  const opts: MapRoleSelectionOptions = {
    columns: () => COLS,
    roles: () => ROLES,
    isSelectable: (m, r) => !inert.has(`${m}|${r}`),
  }
  return useMapRoleSelection(opts)
}

const keys = (api: ReturnType<typeof useMapRoleSelection>) => [...api.selected.value].sort()
const key = (e: Partial<KeyboardEvent>) => ({ preventDefault() {}, shiftKey: false, ...e } as KeyboardEvent)

describe('useMapRoleSelection — plain click', () => {
  it('selects only the clicked cell', () => {
    const s = make()
    s.clickCell('ilios', 'dps', { ctrl: false, shift: false })
    expect(keys(s)).toEqual(['ilios|dps'])
    expect(s.isSelected('ilios', 'dps')).toBe(true)
    expect(s.isSelected('ilios', 'tank')).toBe(false)
  })

  it('clicking another cell replaces the selection', () => {
    const s = make()
    s.clickCell('ilios', 'dps', { ctrl: false, shift: false })
    s.clickCell('oasis', 'tank', { ctrl: false, shift: false })
    expect(keys(s)).toEqual(['oasis|tank'])
  })

  it('re-clicking the lone selected cell clears it (click-off)', () => {
    const s = make()
    s.clickCell('ilios', 'dps', { ctrl: false, shift: false })
    s.clickCell('ilios', 'dps', { ctrl: false, shift: false })
    expect(s.count.value).toBe(0)
  })

  it('ignores a click on a never-played (inert) cell', () => {
    const s = make(['ilios|dps'])
    s.clickCell('ilios', 'dps', { ctrl: false, shift: false })
    expect(s.count.value).toBe(0)
  })
})

describe('useMapRoleSelection — Ctrl/Cmd toggle (non-contiguous)', () => {
  it('adds non-adjacent cells and toggles them back off', () => {
    const s = make()
    s.clickCell('kings-row', 'tank', { ctrl: false, shift: false })
    s.clickCell('oasis', 'support', { ctrl: true, shift: false })
    expect(keys(s)).toEqual(['kings-row|tank', 'oasis|support'])
    s.clickCell('oasis', 'support', { ctrl: true, shift: false })
    expect(keys(s)).toEqual(['kings-row|tank'])
  })

  it('a non-contiguous selection is NOT rectangular', () => {
    const s = make()
    s.clickCell('kings-row', 'tank', { ctrl: false, shift: false })
    s.clickCell('oasis', 'support', { ctrl: true, shift: false })
    expect(s.isRectangular.value).toBe(false)
    expect(s.hullMaps.value).toEqual(['kings-row', 'oasis'])
    expect(s.hullRoles.value).toEqual(['tank', 'support'])
  })
})

describe('useMapRoleSelection — Shift range', () => {
  it('selects the rectangular box from the anchor', () => {
    const s = make()
    s.clickCell('kings-row', 'tank', { ctrl: false, shift: false }) // anchor
    s.clickCell('oasis', 'dps', { ctrl: false, shift: true })
    // cols kings-row..oasis (3) × roles tank..dps (2) = 6 cells
    expect(keys(s)).toEqual([
      'ilios|dps', 'ilios|tank',
      'kings-row|dps', 'kings-row|tank',
      'oasis|dps', 'oasis|tank',
    ])
    expect(s.isRectangular.value).toBe(true)
  })

  it('skips inert cells inside the box but stays "rectangular"', () => {
    const s = make(['ilios|tank'])
    s.clickCell('kings-row', 'tank', { ctrl: false, shift: false })
    s.clickCell('oasis', 'dps', { ctrl: false, shift: true })
    expect(s.isSelected('ilios', 'tank')).toBe(false)
    expect(s.isRectangular.value).toBe(true) // hull minus the inert cell == selection
  })
})

describe('useMapRoleSelection — row / column headers', () => {
  it('selectRow picks the whole role row', () => {
    const s = make()
    s.selectRow('support')
    expect(keys(s)).toEqual(['ilios|support', 'kings-row|support', 'nepal|support', 'oasis|support'])
    expect(s.isRectangular.value).toBe(true)
  })

  it('selectColumn picks the whole map column', () => {
    const s = make()
    s.selectColumn('nepal')
    expect(keys(s)).toEqual(['nepal|dps', 'nepal|support', 'nepal|tank'])
  })

  it('selectColumns picks every selectable cell across a group of columns', () => {
    const s = make()
    s.selectColumns(['ilios', 'oasis']) // a game-mode group's maps
    expect(keys(s)).toEqual([
      'ilios|dps', 'ilios|support', 'ilios|tank',
      'oasis|dps', 'oasis|support', 'oasis|tank',
    ])
    expect(s.isRectangular.value).toBe(true)
  })

  it('Ctrl+row adds the row to an existing selection', () => {
    const s = make()
    s.selectColumn('nepal')
    s.selectRow('tank', { ctrl: true })
    expect(s.isSelected('nepal', 'support')).toBe(true)
    expect(s.isSelected('kings-row', 'tank')).toBe(true)
  })

  it('a row skips inert cells', () => {
    const s = make(['nepal|support'])
    s.selectRow('support')
    expect(s.isSelected('nepal', 'support')).toBe(false)
    expect(s.count.value).toBe(3)
  })
})

describe('useMapRoleSelection — keyboard grid', () => {
  it('arrows move the roving focus', () => {
    const s = make()
    s.clickCell('kings-row', 'tank', { ctrl: false, shift: false })
    s.onCellKeydown('kings-row', 'tank', key({ key: 'ArrowRight' }))
    expect(s.isFocused('ilios', 'tank')).toBe(true)
    s.onCellKeydown('ilios', 'tank', key({ key: 'ArrowDown' }))
    expect(s.isFocused('ilios', 'dps')).toBe(true)
  })

  it('Space toggles the focused cell', () => {
    const s = make()
    s.onCellKeydown('ilios', 'dps', key({ key: ' ' }))
    expect(s.isSelected('ilios', 'dps')).toBe(true)
    s.onCellKeydown('ilios', 'dps', key({ key: ' ' }))
    expect(s.isSelected('ilios', 'dps')).toBe(false)
  })

  it('Shift+arrow extends a box from the anchor', () => {
    const s = make()
    s.clickCell('kings-row', 'tank', { ctrl: false, shift: false }) // anchor
    s.onCellKeydown('kings-row', 'tank', key({ key: 'ArrowRight', shiftKey: true }))
    expect(keys(s)).toEqual(['ilios|tank', 'kings-row|tank'])
  })

  it('Escape clears the selection', () => {
    const s = make()
    s.selectRow('tank')
    s.onCellKeydown('kings-row', 'tank', key({ key: 'Escape' }))
    expect(s.count.value).toBe(0)
  })
})

describe('useMapRoleSelection — clear', () => {
  it('empties the selection and the anchor', () => {
    const s = make()
    s.selectColumn('ilios')
    s.clear()
    expect(s.count.value).toBe(0)
    // a subsequent shift-click has no anchor → falls back to a plain select
    s.clickCell('oasis', 'dps', { ctrl: false, shift: true })
    expect(keys(s)).toEqual(['oasis|dps'])
  })
})
