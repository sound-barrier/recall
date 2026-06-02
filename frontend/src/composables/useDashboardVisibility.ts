import { computed, type Ref, type ComputedRef } from 'vue'
import { usePersistedRef, parseStringArray, serializeStringArray } from './usePersistedRef'
import { WIDGET_REGISTRY, widgetById } from '../dashboard/widgets'

// Persisted hide/show preference for dossier widgets. Presence of an
// ID in the array IS the "hidden" state; absence = visible. Mirrors
// the same "absence-is-default" shape we use for the per-match
// `hidden_matches` table on the backend.
//
// IDs not in WIDGET_REGISTRY are silently dropped on read — if a
// widget is renamed or removed later, stale localStorage values
// degrade to "visible by default" instead of stranding the user.

const STORAGE_KEY = 'recall.dashboard.hidden'

export interface DashboardVisibilityApi {
  hidden: Ref<string[]>
  // True iff the id is in the hidden set AND the widget is still
  // registered. Unknown / orphan ids read as not hidden.
  isHidden: ComputedRef<(id: string) => boolean>
  hide: (id: string) => void
  show: (id: string) => void
  toggle: (id: string) => void
  // Wipes the persisted set back to the registry's defaultVisible
  // baseline (currently every widget visible — no widget ships with
  // defaultVisible:false). The signature stays future-proof: if a
  // future widget defaults to hidden, reset() seeds it as such.
  reset: () => void
  // Convenience surface for the customizer modal: every registered
  // widget plus its current visibility. Lets the modal render a flat
  // list without re-deriving the union elsewhere.
  allWidgetStates: ComputedRef<Array<{ id: string; visible: boolean }>>
}

// Module-level singleton — every consumer reads the same reactive
// ref. Mirrors useTheme / useOWData. The first call kicks off the
// onMounted hydrate; later calls reuse the existing ref.
let cached: DashboardVisibilityApi | null = null

export function useDashboardVisibility(): DashboardVisibilityApi {
  if (cached) return cached

  const { value: hidden, set } = usePersistedRef<string[]>({
    key: STORAGE_KEY,
    defaultValue: defaultHiddenSet(),
    parse: (raw) => {
      const decoded = parseStringArray(raw)
      if (decoded === undefined) return undefined
      // Drop ids that no longer match a registered widget. The
      // result is what the rest of the app sees as `hidden.value`.
      return decoded.filter((id) => widgetById(id) !== undefined)
    },
    serialize: serializeStringArray,
  })

  function hide(id: string) {
    if (!widgetById(id)) return
    if (hidden.value.includes(id)) return
    set([...hidden.value, id])
  }

  function show(id: string) {
    if (!hidden.value.includes(id)) return
    set(hidden.value.filter((x) => x !== id))
  }

  function toggle(id: string) {
    if (hidden.value.includes(id)) {
      show(id)
    } else {
      hide(id)
    }
  }

  function reset() {
    set(defaultHiddenSet())
  }

  const isHidden = computed(() => {
    const set = new Set(hidden.value)
    return (id: string) => set.has(id)
  })

  const allWidgetStates = computed(() => {
    const hiddenSet = new Set(hidden.value)
    return WIDGET_REGISTRY.map((def) => ({
      id: def.id,
      visible: !hiddenSet.has(def.id),
    }))
  })

  cached = { hidden, isHidden, hide, show, toggle, reset, allWidgetStates }
  return cached
}

// Test seam — flush the module-level cache so SFC tests that seed
// localStorage between mounts read a fresh hydrate. Production
// callers never need this.
export function _resetDashboardVisibilityForTest(): void {
  cached = null
}

function defaultHiddenSet(): string[] {
  return WIDGET_REGISTRY.filter((w) => !w.defaultVisible).map((w) => w.id)
}
