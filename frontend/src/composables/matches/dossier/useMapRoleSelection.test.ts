import { describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useMapRoleSelection, type MapRoleSelectionOptions } from '@/composables/matches/dossier/useMapRoleSelection'

// Grid fixture: 4 maps × 3 roles. By default every cell is selectable; pass an
// `unselectable` set (`map|role`) to model never-played (inert) cells.
const COLS = ['kings-row', 'ilios', 'oasis', 'nepal']
const ROLES = ['tank', 'dps', 'support']

function make(unselectable: string[] = [], onClear?: () => void) {
  const inert = new Set(unselectable)
  const opts: MapRoleSelectionOptions = {
    columns: () => COLS,
    roles: () => ROLES,
    isSelectable: (m, r) => !inert.has(`${m}|${r}`),
    onClear,
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

  it('a row skips inert cells', () => {
    const s = make(['nepal|support'])
    s.selectRow('support')
    expect(s.isSelected('nepal', 'support')).toBe(false)
    expect(s.count.value).toBe(3)
  })
})

// The "facet" model: game-mode/map headers set the MAPS dimension (× all roles);
// a role header narrows the ROLES dimension within the currently-selected maps.
// Plain replaces a dimension, Ctrl/Cmd adds, Shift ranges — Excel vocabulary.
describe('useMapRoleSelection — facet (maps × roles) headers', () => {
  it('a role narrows to that role within the selected maps (keeps the maps)', () => {
    const s = make()
    s.selectColumns(['ilios', 'oasis']) // 2 maps × all roles (6)
    s.selectRow('tank')                 // narrow → 2 maps × tank
    expect(keys(s)).toEqual(['ilios|tank', 'oasis|tank'])
  })

  it('plain-clicking the lone selected role un-narrows back to all roles', () => {
    const s = make()
    s.selectColumn('ilios')
    s.selectRow('tank')   // ilios × tank
    s.selectRow('tank')   // toggle → ilios × all roles
    expect(keys(s)).toEqual(['ilios|dps', 'ilios|support', 'ilios|tank'])
  })

  it('clicking a different role switches the narrow (never empties)', () => {
    const s = make()
    s.selectColumn('ilios')
    s.selectRow('tank')      // ilios × tank
    s.selectRow('support')   // ilios × support
    expect(keys(s)).toEqual(['ilios|support'])
  })

  it('Ctrl+role adds a second role within the current maps', () => {
    const s = make()
    s.selectColumn('ilios')
    s.selectRow('tank')
    s.selectRow('support', { ctrl: true })
    expect(keys(s)).toEqual(['ilios|support', 'ilios|tank'])
  })

  it('Shift+role selects a contiguous range of roles within the maps', () => {
    const s = make()
    s.selectColumn('nepal')
    s.selectRow('tank')                     // anchor = tank
    s.selectRow('support', { shift: true }) // tank..support = all 3 roles
    expect(keys(s)).toEqual(['nepal|dps', 'nepal|support', 'nepal|tank'])
  })

  it('Ctrl+column adds another map column, keeping all roles', () => {
    const s = make()
    s.selectColumn('ilios')
    s.selectColumn('nepal', { ctrl: true })
    expect(s.hullMaps.value).toEqual(['ilios', 'nepal'])
    expect(s.count.value).toBe(6)
  })

  it('Shift+column selects a contiguous range of columns', () => {
    const s = make()
    s.selectColumn('kings-row')              // anchor column
    s.selectColumn('oasis', { shift: true }) // kings-row..oasis = 3 cols × 3 roles
    expect(s.hullMaps.value).toEqual(['kings-row', 'ilios', 'oasis'])
    expect(s.count.value).toBe(9)
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

  it('Enter on an empty cell clears the selection AND calls onClear (reset)', () => {
    const onClear = vi.fn()
    const s = make(['ilios|tank'], onClear) // ilios|tank inert (empty)
    s.selectColumn('nepal')
    expect(s.count.value).toBe(3)
    s.onCellKeydown('ilios', 'tank', key({ key: 'Enter' }))
    expect(s.count.value).toBe(0)
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})

// ── Rubber-band drag ────────────────────────────────────────────────
//
// The drag arm is the one path that reaches out to window listeners: the
// press installs mousemove/mouseup on window, the move resolves a viewport
// point back to a cell through the SFC's elementFromPoint shim, and the
// release commits (or, with no movement, degrades to a click). The grid is
// laid out at 100px cells so a point maps to a cell by integer division.
const CELL = 100
const pointAt = (map: string, role: string) => ({
  x: COLS.indexOf(map) * CELL + CELL / 2,
  y: ROLES.indexOf(role) * CELL + CELL / 2,
})

function makeDraggable(unselectable: string[] = [], onClear?: () => void) {
  const inert = new Set(unselectable)
  return useMapRoleSelection({
    columns: () => COLS,
    roles: () => ROLES,
    isSelectable: (m, r) => !inert.has(`${m}|${r}`),
    cellFromPoint: (x, y) => {
      const map = COLS[Math.floor(x / CELL)]
      const role = ROLES[Math.floor(y / CELL)]
      return map && role ? { map, role } : null
    },
    onClear,
  })
}

function pressOn(api: ReturnType<typeof useMapRoleSelection>, map: string, role: string, mods: Partial<MouseEventInit> = {}) {
  const p = pointAt(map, role)
  api.onCellPointerDown(map, role, new MouseEvent('mousedown', { clientX: p.x, clientY: p.y, ...mods }))
}
function moveTo(map: string, role: string) {
  const p = pointAt(map, role)
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: p.x, clientY: p.y }))
}
function release(mods: Partial<MouseEventInit> = {}) {
  window.dispatchEvent(new MouseEvent('mouseup', mods))
}

describe('useMapRoleSelection — rubber-band drag', () => {
  it('selects every selectable cell inside the dragged box', () => {
    const s = makeDraggable()
    pressOn(s, 'kings-row', 'tank')
    moveTo('oasis', 'dps')
    release()
    // 3 columns × 2 roles.
    expect(keys(s)).toEqual([
      'ilios|dps', 'ilios|tank',
      'kings-row|dps', 'kings-row|tank',
      'oasis|dps', 'oasis|tank',
    ])
    expect(s.isRectangular.value).toBe(true)
  })

  it('previews the live box mid-drag, before the release commits it', () => {
    const s = makeDraggable()
    pressOn(s, 'kings-row', 'tank')
    moveTo('ilios', 'dps')

    expect(s.isInDragBox('ilios', 'tank')).toBe(true)
    expect(s.isInDragBox('oasis', 'tank')).toBe(false)
    // Nothing is committed until mouseup — the preview is a hint, not state.
    expect(s.count.value).toBe(0)
    release()
    expect(s.count.value).toBe(4)
  })

  it('shows no preview box for a press that has not moved yet', () => {
    const s = makeDraggable()
    pressOn(s, 'kings-row', 'tank')
    expect(s.isInDragBox('kings-row', 'tank')).toBe(false)
    release()
  })

  it('degrades to a plain click when the press never moved', () => {
    const s = makeDraggable()
    s.clickCell('nepal', 'support', { ctrl: false, shift: false })
    pressOn(s, 'ilios', 'dps')
    release()
    // Collapse-to-one, exactly like clickCell — not a 1×1 drag box that
    // would have left the previous selection alone.
    expect(keys(s)).toEqual(['ilios|dps'])
  })

  it('Ctrl-drag ADDS the box to the existing selection instead of replacing it', () => {
    const s = makeDraggable()
    s.clickCell('nepal', 'support', { ctrl: false, shift: false })
    pressOn(s, 'kings-row', 'tank', { ctrlKey: true })
    moveTo('ilios', 'tank')
    release({ ctrlKey: true })

    expect(keys(s)).toEqual(['ilios|tank', 'kings-row|tank', 'nepal|support'])
    // Two disjoint runs are not a rectangle, so the narrow can't collapse
    // them to a hull without pulling in cells the user never picked.
    expect(s.isRectangular.value).toBe(false)
  })

  it('skips never-played cells inside the box', () => {
    const s = makeDraggable(['ilios|tank'])
    pressOn(s, 'kings-row', 'tank')
    moveTo('ilios', 'dps')
    release()
    expect(keys(s)).toEqual(['ilios|dps', 'kings-row|dps', 'kings-row|tank'])
  })

  it('a motionless press on an empty cell resets the selection AND the filter', () => {
    const onClear = vi.fn()
    const s = makeDraggable(['ilios|tank'], onClear)
    s.selectColumn('nepal')
    pressOn(s, 'ilios', 'tank')
    release()

    expect(s.count.value).toBe(0)
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('Ctrl-clicking an empty cell leaves the selection alone (no accidental reset)', () => {
    const onClear = vi.fn()
    const s = makeDraggable(['ilios|tank'], onClear)
    s.selectColumn('nepal')
    pressOn(s, 'ilios', 'tank', { ctrlKey: true })
    release({ ctrlKey: true })

    expect(s.count.value).toBe(3)
    expect(onClear).not.toHaveBeenCalled()
  })

  it('shift-clicking a played cell resolves as a range without starting a drag', () => {
    const s = makeDraggable()
    s.clickCell('kings-row', 'tank', { ctrl: false, shift: false }) // anchor
    pressOn(s, 'ilios', 'dps', { shiftKey: true })
    // No drag is in flight, so a stray move must not repaint a preview.
    moveTo('nepal', 'support')
    expect(s.isInDragBox('nepal', 'support')).toBe(false)
    expect(keys(s)).toEqual(['ilios|dps', 'ilios|tank', 'kings-row|dps', 'kings-row|tank'])
  })

  it('drops its window listeners on release', () => {
    const s = makeDraggable()
    pressOn(s, 'kings-row', 'tank')
    moveTo('ilios', 'tank')
    release()
    const after = keys(s)

    // A move after the gesture ended must not keep repainting the box.
    moveTo('nepal', 'support')
    release()
    expect(keys(s)).toEqual(after)
  })

  it('drops its window listeners when the band unmounts mid-gesture', () => {
    const scope = effectScope()
    let s!: ReturnType<typeof useMapRoleSelection>
    scope.run(() => { s = makeDraggable() })
    pressOn(s, 'kings-row', 'tank')
    scope.stop()

    // The user releases the button after navigating away; nothing must
    // still be listening.
    moveTo('oasis', 'support')
    release()
    expect(s.count.value).toBe(0)
  })
})

describe('useMapRoleSelection — degenerate inputs', () => {
  it('treats an empty selection as rectangular (nothing to over-select)', () => {
    const s = make()
    expect(s.isRectangular.value).toBe(true)
    expect(s.hullMaps.value).toEqual([])
    expect(s.hullRoles.value).toEqual([])
  })

  it('ignores a range against a cell that is not in the grid', () => {
    const s = make()
    s.clickCell('kings-row', 'tank', { ctrl: false, shift: false })
    s.clickCell('retired-map', 'tank', { ctrl: false, shift: true })
    // boxKeys can't place the far corner, so the range is empty rather than
    // wrapping around to select the whole row.
    expect(s.count.value).toBe(0)
  })

  it('shift-clicking a column header with no prior anchor selects just that column', () => {
    const s = make()
    s.selectColumns(['ilios'], { shift: true })
    expect(s.hullMaps.value).toEqual(['ilios'])
    expect(s.count.value).toBe(3)
  })

  it('a header selection over an entirely never-played column is a no-op', () => {
    const s = make(['nepal|tank', 'nepal|dps', 'nepal|support'])
    s.selectColumn('ilios')
    s.selectColumn('nepal')
    // Committing an empty product would blank the selection AND the filter
    // for a column the user can't have meant to pick.
    expect(s.hullMaps.value).toEqual(['ilios'])
  })

  it('an arrow key with nothing focused starts from the top-left cell', () => {
    const s = make()
    s.onCellKeydown('kings-row', 'tank', key({ key: 'ArrowUp' }))
    expect(s.isFocused('kings-row', 'tank')).toBe(true)
    s.onCellKeydown('kings-row', 'tank', key({ key: 'ArrowLeft' }))
    expect(s.isFocused('kings-row', 'tank')).toBe(true)
  })

  it('Space on a never-played cell selects nothing', () => {
    const s = make(['ilios|dps'])
    s.onCellKeydown('ilios', 'dps', key({ key: ' ' }))
    expect(s.count.value).toBe(0)
    expect(s.isFocused('ilios', 'dps')).toBe(true)
  })

  it('passes an unhandled key through untouched', () => {
    const s = make()
    s.selectColumn('ilios')
    const preventDefault = vi.fn()
    s.onCellKeydown('oasis', 'tank', { preventDefault, shiftKey: false, key: 'a' } as unknown as KeyboardEvent)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(s.hullMaps.value).toEqual(['ilios'])
  })
})
