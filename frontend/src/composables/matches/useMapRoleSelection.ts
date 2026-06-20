import { computed, type ComputedRef, onScopeDispose, type Ref, ref } from 'vue'

// Spreadsheet-style selection engine for the Geography (map × role) band. Owns
// WHICH cells are selected — a Set of `${map}|${role}` keys — plus the range
// anchor and the roving keyboard-focus cell. It is DOM-agnostic + pure (the SFC
// supplies the ordered columns/roles, a selectability predicate, and — for drag —
// a point→cell resolver), so every selection path is unit-testable without a
// browser. Stats + filtering live in the SFC; this only answers "what's selected".

type CellKey = string
export interface MapRoleCoord { map: string; role: string }

interface PointerMods { ctrl: boolean; shift: boolean }

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
  // Called when the user clicks an empty (non-selectable) cell with no drag —
  // the calendar-style "click nothing to reset". The SFC clears its filter here.
  onClear?: () => void
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
    const mods = { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }
    if (opts.isSelectable(start.map, start.role)) {
      clickCell(start.map, start.role, mods)
    } else if (!mods.ctrl && !mods.shift) {
      // A plain click on an empty cell resets — clears the selection + the SFC's
      // filter (the calendar-style "click nothing to reset").
      clear()
      opts.onClear?.()
    }
  }

  function onCellPointerDown(map: string, role: string, e: MouseEvent) {
    e.preventDefault() // suppress native text/drag selection that swallows mousemove
    // Shift-click on a played cell resolves immediately (no drag) so a range never
    // starts a box. Empty cells fall through to the drag arm below, so a rubber-band
    // can start/stop on a blank square (mirrors the Campaign Log heatmap).
    if (e.shiftKey && anchor.value && opts.isSelectable(map, role)) {
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

  // ── Header selection — a maps × roles "facet" model ────────────────
  // Game-mode + map headers set the MAPS dimension (spanning all roles); a role
  // header narrows the ROLES dimension within the currently-selected maps. Each
  // header carries the Excel modifier vocabulary: plain = replace that dimension,
  // Ctrl/⌘ = add to it, Shift = range from the last header clicked. Re-clicking
  // the lone selected role un-narrows back to all roles.
  const colAnchor = ref<string | null>(null)
  const roleAnchor = ref<string | null>(null)

  function product(maps: readonly string[], roles: readonly string[]): CellKey[] {
    const out: CellKey[] = []
    for (const m of maps) for (const r of roles) if (opts.isSelectable(m, r)) out.push(key(m, r))
    return out
  }
  function rangeBetween(list: readonly string[], from: string | null, to: string): string[] {
    const a = from == null ? list.indexOf(to) : list.indexOf(from)
    const b = list.indexOf(to)
    if (a < 0 || b < 0) return [to]
    const [lo, hi] = a <= b ? [a, b] : [b, a]
    return list.slice(lo, hi + 1)
  }
  function commitFacet(maps: readonly string[], roles: readonly string[]) {
    const keys = product(maps, roles)
    if (!keys.length) return
    replace(keys)
    const first = keys[0]!; const i = first.lastIndexOf('|')
    anchor.value = { map: first.slice(0, i), role: first.slice(i + 1) }
    focused.value = anchor.value
  }

  // Game-mode group / single map → set the MAPS dimension (× all roles).
  function selectColumns(maps: readonly string[], mods: Partial<PointerMods> = {}) {
    const last = maps[maps.length - 1] ?? maps[0]!
    let next: string[]
    if (mods.shift) next = rangeBetween(opts.columns(), colAnchor.value, last)
    else if (mods.ctrl) next = [...new Set([...hullMaps.value, ...maps])]
    else next = [...maps]
    commitFacet(next, opts.roles())
    if (!mods.shift) colAnchor.value = last
  }
  function selectColumn(map: string, mods: Partial<PointerMods> = {}) {
    selectColumns([map], mods)
  }

  // Role header → narrow the ROLES dimension within the currently-selected maps.
  function selectRow(role: string, mods: Partial<PointerMods> = {}) {
    const maps = hullMaps.value.length ? hullMaps.value : [...opts.columns()]
    const cur = hullRoles.value
    let next: string[]
    if (mods.shift) next = rangeBetween(opts.roles(), roleAnchor.value, role)
    else if (mods.ctrl) next = [...new Set([...cur, role])]
    else next = (cur.length === 1 && cur[0] === role) ? [...opts.roles()] : [role]
    commitFacet(maps, next)
    if (!mods.shift) roleAnchor.value = role
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
      case 'Enter': // collapse to just the focused cell; empty cell → reset
        e.preventDefault()
        if (opts.isSelectable(map, role)) clickCell(map, role, { ctrl: false, shift: false })
        else { clear(); opts.onClear?.() }
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
