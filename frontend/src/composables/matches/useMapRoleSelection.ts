import { computed, type ComputedRef, onScopeDispose, type Ref, ref } from 'vue'

// Spreadsheet-style selection engine for the Geography (map × role) band. Owns
// WHICH cells are selected — a Set of `${map}|${role}` keys — plus the range
// anchor and the roving keyboard-focus cell. It is DOM-agnostic + pure (the SFC
// supplies the ordered columns/roles, a selectability predicate, and — for drag —
// a point→cell resolver), so every selection path is unit-testable without a
// browser. Stats + filtering live in the SFC; this only answers "what's selected".

export type CellKey = string
export interface MapRoleCoord { map: string; role: string }

export interface PointerMods { ctrl: boolean; shift: boolean }

export interface MapRoleSelectionOptions {
  // Ordered map slugs (grid columns, left → right) — drives range + drag boxes.
  columns: () => readonly string[]
  // Ordered roles (grid rows, top → bottom).
  roles: () => readonly string[]
  // Only selectable (played-in-window) cells can enter the selection.
  isSelectable: (map: string, role: string) => boolean
  // Resolve a viewport point to the cell under it (the SFC implements this with
  // document.elementFromPoint + data-* attrs). Required only for drag.
  cellFromPoint?: (x: number, y: number) => MapRoleCoord | null
}

export interface MapRoleSelectionApi {
  selected: Ref<Set<CellKey>>
  focused: Ref<MapRoleCoord | null>
  count: ComputedRef<number>
  // The maps / roles spanned by the selection — the rectangular hull the narrow
  // filters to. `isRectangular` is true when the selection IS exactly that hull
  // (single cell, row, column, or drag-box), so the filter is exact, not a superset.
  hullMaps: ComputedRef<string[]>
  hullRoles: ComputedRef<string[]>
  isRectangular: ComputedRef<boolean>
  isSelected: (map: string, role: string) => boolean
  isFocused: (map: string, role: string) => boolean
  isInDragBox: (map: string, role: string) => boolean
  keyFor: (map: string, role: string) => CellKey
  // Modifier-aware click — plain (collapse / click-off), Ctrl·Cmd (toggle one,
  // non-contiguous), Shift (range from the anchor). The press handler calls this
  // on a no-movement release; exposed so the semantics are unit-testable.
  clickCell: (map: string, role: string, mods: PointerMods) => void
  // Pointer: a press that becomes a drag-box on move or a click on release. Call
  // from the cell's mousedown.
  onCellPointerDown: (map: string, role: string, e: MouseEvent) => void
  // Header clicks — whole row / column(s) (Ctrl/Cmd adds to the selection).
  // selectColumns drives the game-mode group header (a run of map columns).
  selectRow: (role: string, mods?: Partial<PointerMods>) => void
  selectColumn: (map: string, mods?: Partial<PointerMods>) => void
  selectColumns: (maps: readonly string[], mods?: Partial<PointerMods>) => void
  // WAI-ARIA grid keyboard: arrows move focus, Space/Ctrl-Space toggle, Enter
  // selects only the focused cell, Shift+arrow extends a box from the anchor.
  onCellKeydown: (map: string, role: string, e: KeyboardEvent) => void
  clear: () => void
}

const key = (map: string, role: string): CellKey => `${map}|${role}`

export function useMapRoleSelection(opts: MapRoleSelectionOptions): MapRoleSelectionApi {
  const selected = ref<Set<CellKey>>(new Set())
  const anchor = ref<MapRoleCoord | null>(null)
  const focused = ref<MapRoleCoord | null>(null)

  // Live drag box (start → hover) while a drag is in flight.
  const dragStart = ref<MapRoleCoord | null>(null)
  const dragHover = ref<MapRoleCoord | null>(null)
  const dragAdditive = ref(false)
  let dragMoved = false

  const isSelected = (map: string, role: string) => selected.value.has(key(map, role))
  const isFocused = (map: string, role: string) =>
    focused.value?.map === map && focused.value?.role === role
  const count = computed(() => selected.value.size)

  // ── geometry over the ordered grid ───────────────────────────────
  function boxKeys(a: MapRoleCoord, b: MapRoleCoord): CellKey[] {
    const cols = opts.columns()
    const roles = opts.roles()
    const ca = cols.indexOf(a.map); const cb = cols.indexOf(b.map)
    const ra = roles.indexOf(a.role); const rb = roles.indexOf(b.role)
    if (ca < 0 || cb < 0 || ra < 0 || rb < 0) return []
    const [c0, c1] = ca <= cb ? [ca, cb] : [cb, ca]
    const [r0, r1] = ra <= rb ? [ra, rb] : [rb, ra]
    const out: CellKey[] = []
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        const m = cols[c]!; const ro = roles[r]!
        if (opts.isSelectable(m, ro)) out.push(key(m, ro))
      }
    }
    return out
  }

  function replace(keys: Iterable<CellKey>) { selected.value = new Set(keys) }
  function add(keys: Iterable<CellKey>) {
    const next = new Set(selected.value)
    for (const k of keys) next.add(k)
    selected.value = next
  }
  function toggle(map: string, role: string) {
    const k = key(map, role)
    const next = new Set(selected.value)
    if (next.has(k)) next.delete(k); else next.add(k)
    selected.value = next
  }

  // ── click semantics (resolved from the press modifiers) ───────────
  function clickCell(map: string, role: string, mods: PointerMods) {
    if (!opts.isSelectable(map, role)) return
    focused.value = { map, role }
    if (mods.shift && anchor.value) {
      replace(boxKeys(anchor.value, { map, role }))
      return
    }
    if (mods.ctrl) {
      toggle(map, role)
      anchor.value = { map, role }
      return
    }
    // Plain click: re-clicking the lone selected cell clears (click-off), else
    // collapse to just this cell — mirrors the Campaign Log calendar.
    if (selected.value.size === 1 && isSelected(map, role)) {
      selected.value = new Set()
    } else {
      replace([key(map, role)])
    }
    anchor.value = { map, role }
  }

  // ── pointer press → drag-box | click ──────────────────────────────
  function onWindowMove(e: MouseEvent) {
    if (!dragStart.value) return
    const cell = opts.cellFromPoint?.(e.clientX, e.clientY) ?? null
    if (!cell) return
    if (cell.map !== dragStart.value.map || cell.role !== dragStart.value.role) dragMoved = true
    dragHover.value = cell
  }

  function onWindowUp(e: MouseEvent) {
    window.removeEventListener('mousemove', onWindowMove)
    window.removeEventListener('mouseup', onWindowUp)
    const start = dragStart.value
    const hover = dragHover.value
    const additive = dragAdditive.value
    dragStart.value = null
    dragHover.value = null
    if (!start) return
    if (dragMoved && hover) {
      const box = boxKeys(start, hover)
      if (additive) add(box); else replace(box)
      anchor.value = start
      focused.value = hover
      return
    }
    clickCell(start.map, start.role, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })
  }

  function onCellPointerDown(map: string, role: string, e: MouseEvent) {
    if (!opts.isSelectable(map, role)) return
    e.preventDefault() // suppress native text/drag selection that swallows mousemove
    // Shift-click resolves immediately (no drag) so a range never starts a box.
    if (e.shiftKey && anchor.value) {
      clickCell(map, role, { ctrl: false, shift: true })
      return
    }
    dragStart.value = { map, role }
    dragHover.value = { map, role }
    dragAdditive.value = e.ctrlKey || e.metaKey
    dragMoved = false
    window.addEventListener('mousemove', onWindowMove)
    window.addEventListener('mouseup', onWindowUp)
  }

  const isInDragBox = (map: string, role: string): boolean => {
    if (!dragStart.value || !dragHover.value || !dragMoved) return false
    return boxKeys(dragStart.value, dragHover.value).includes(key(map, role))
  }

  // ── header (row / column) selection ───────────────────────────────
  function rowKeys(role: string): CellKey[] {
    return opts.columns().filter((m) => opts.isSelectable(m, role)).map((m) => key(m, role))
  }
  function colKeys(map: string): CellKey[] {
    return opts.roles().filter((r) => opts.isSelectable(map, r)).map((r) => key(map, r))
  }
  function selectRow(role: string, mods: Partial<PointerMods> = {}) {
    const keys = rowKeys(role)
    if (!keys.length) return
    if (mods.ctrl) add(keys); else replace(keys)
    const firstMap = opts.columns().find((m) => opts.isSelectable(m, role))
    if (firstMap) { anchor.value = { map: firstMap, role }; focused.value = { map: firstMap, role } }
  }
  // Select one or more whole columns (a single map, or a game-mode group's maps).
  function selectColumns(maps: readonly string[], mods: Partial<PointerMods> = {}) {
    const keys: CellKey[] = []
    for (const m of maps) keys.push(...colKeys(m))
    if (!keys.length) return
    if (mods.ctrl) add(keys); else replace(keys)
    // Anchor on the first selectable cell across the columns (column-major).
    for (const m of maps) {
      const r = opts.roles().find((ro) => opts.isSelectable(m, ro))
      if (r) { anchor.value = { map: m, role: r }; focused.value = { map: m, role: r }; break }
    }
  }
  function selectColumn(map: string, mods: Partial<PointerMods> = {}) {
    selectColumns([map], mods)
  }

  // ── rectangular hull (what the narrow filters to) ─────────────────
  const hullMaps = computed(() => {
    const maps = new Set<string>()
    for (const k of selected.value) maps.add(k.slice(0, k.lastIndexOf('|')))
    return opts.columns().filter((m) => maps.has(m))
  })
  const hullRoles = computed(() => {
    const roles = new Set<string>()
    for (const k of selected.value) roles.add(k.slice(k.lastIndexOf('|') + 1))
    return opts.roles().filter((r) => roles.has(r))
  })
  // The selection equals its hull exactly when every selectable hull cell is
  // selected — i.e. it's a true rectangle / row / column / single cell, so a
  // rectangular narrow filters it without pulling in extra cells.
  const isRectangular = computed(() => {
    if (selected.value.size === 0) return true
    let hullSelectable = 0
    for (const m of hullMaps.value) {
      for (const r of hullRoles.value) {
        if (opts.isSelectable(m, r)) hullSelectable++
      }
    }
    return hullSelectable === selected.value.size
  })

  // ── keyboard grid (WAI-ARIA) ──────────────────────────────────────
  function moveFocus(dCol: number, dRole: number, shift: boolean) {
    const cols = opts.columns(); const roles = opts.roles()
    const cur = focused.value ?? anchor.value ?? { map: cols[0]!, role: roles[0]! }
    const ci = Math.min(Math.max(cols.indexOf(cur.map) + dCol, 0), cols.length - 1)
    const ri = Math.min(Math.max(roles.indexOf(cur.role) + dRole, 0), roles.length - 1)
    const next = { map: cols[ci]!, role: roles[ri]! }
    focused.value = next
    if (shift && anchor.value) replace(boxKeys(anchor.value, next))
  }

  function onCellKeydown(map: string, role: string, e: KeyboardEvent) {
    focused.value = { map, role }
    const shift = e.shiftKey
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); moveFocus(1, 0, shift); break
      case 'ArrowLeft':  e.preventDefault(); moveFocus(-1, 0, shift); break
      case 'ArrowDown':  e.preventDefault(); moveFocus(0, 1, shift); break
      case 'ArrowUp':    e.preventDefault(); moveFocus(0, -1, shift); break
      case ' ': // Space toggles the focused cell (Ctrl/Cmd optional — same here)
        e.preventDefault()
        if (opts.isSelectable(map, role)) { toggle(map, role); anchor.value = { map, role } }
        break
      case 'Enter': // collapse to just the focused cell
        e.preventDefault()
        clickCell(map, role, { ctrl: false, shift: false })
        break
      case 'Escape': e.preventDefault(); clear(); break
    }
  }

  function clear() {
    selected.value = new Set()
    anchor.value = null
  }

  // Drop the window drag listeners if the host unmounts mid-gesture.
  onScopeDispose(() => {
    window.removeEventListener('mousemove', onWindowMove)
    window.removeEventListener('mouseup', onWindowUp)
  })

  return {
    selected, focused, count,
    hullMaps, hullRoles, isRectangular,
    isSelected, isFocused, isInDragBox,
    keyFor: key,
    clickCell,
    onCellPointerDown, selectRow, selectColumn, selectColumns, onCellKeydown, clear,
  }
}
