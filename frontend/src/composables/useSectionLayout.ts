import { computed, type ComputedRef } from 'vue'
import {
  usePersistedRef,
  parseJsonRecord,
  serializeJsonRecord,
} from './usePersistedRef'

// Full-width "sections" that render below the dossier widget grid in
// the Matches view (Campaign Log, Geography). Unlike dossier widgets,
// they're not part of the row-packed grid — they stack full width,
// always below the dossier. The user can hide / re-add them and
// reorder them among themselves. Both ship visible.
//
// Persistence mirrors useDashboardLayout: a cached module singleton so
// the render loop and the Add/Reset menu share one reactive instance,
// backed by usePersistedRef (which also cross-syncs sibling instances
// via the recall-pref-changed event).

export interface SectionDef {
  id: string
  label: string
}

// Install order + the canonical id↔label map. Adding a new section is
// a one-line append here plus its render branch in MatchesView.
const SECTION_REGISTRY: readonly SectionDef[] = [
  { id: 'campaign-log', label: 'Campaign Log' },
  { id: 'geography', label: 'Geography' },
]

export interface SectionState {
  id: string
  visible: boolean
}

export const SECTIONS_STORAGE_KEY = 'recall.dashboard.sections'

export function defaultSections(): SectionState[] {
  return SECTION_REGISTRY.map((s) => ({ id: s.id, visible: true }))
}

export function isSectionStateArray(decoded: unknown): decoded is SectionState[] {
  return (
    Array.isArray(decoded) &&
    decoded.every((e) => {
      if (e === null || typeof e !== 'object' || Array.isArray(e)) return false
      const keys = Object.keys(e as Record<string, unknown>)
      return (
        keys.length === 2 &&
        keys.includes('id') &&
        keys.includes('visible') &&
        typeof (e as SectionState).id === 'string' &&
        typeof (e as SectionState).visible === 'boolean'
      )
    })
  )
}

// Reconcile stored state against the registry: drop unknown / dupe
// ids, then append any registry ids the stored list is missing
// (default visible) so a newly-shipped section appears for users who
// already have a persisted list.
export function reconcileSections(stored: SectionState[]): SectionState[] {
  const known = new Set(SECTION_REGISTRY.map((s) => s.id))
  const seen = new Set<string>()
  const out: SectionState[] = []
  for (const s of stored) {
    if (!known.has(s.id) || seen.has(s.id)) continue
    seen.add(s.id)
    out.push({ id: s.id, visible: s.visible })
  }
  for (const def of SECTION_REGISTRY) {
    if (!seen.has(def.id)) out.push({ id: def.id, visible: true })
  }
  return out
}

export interface SectionLayoutApi {
  // Reconciled full ordered list (visible + hidden).
  sections: ComputedRef<SectionState[]>
  // Visible section ids, in order — the render loop's source.
  visibleIds: ComputedRef<string[]>
  // Registry entries currently hidden — the Add menu's source.
  addable: ComputedRef<SectionDef[]>
  labelFor: (id: string) => string
  isVisible: (id: string) => boolean
  remove: (id: string) => void
  add: (id: string) => void
  // Reorder within the full list. Indices are into `sections`.
  move: (fromIdx: number, toIdx: number) => void
  reset: () => void
}

let cached: SectionLayoutApi | null = null

export function useSectionLayout(): SectionLayoutApi {
  if (cached) return cached

  const { value: raw, set } = usePersistedRef<SectionState[]>({
    key: SECTIONS_STORAGE_KEY,
    defaultValue: defaultSections(),
    parse: parseJsonRecord(isSectionStateArray),
    serialize: serializeJsonRecord,
  })

  const sections = computed(() => reconcileSections(raw.value))
  const visibleIds = computed(() => sections.value.filter((s) => s.visible).map((s) => s.id))
  const addable = computed(() => {
    const hidden = new Set(sections.value.filter((s) => !s.visible).map((s) => s.id))
    return SECTION_REGISTRY.filter((d) => hidden.has(d.id))
  })

  const labelFor = (id: string) => SECTION_REGISTRY.find((s) => s.id === id)?.label ?? id
  const isVisible = (id: string) => sections.value.some((s) => s.id === id && s.visible)

  function setVisible(id: string, visible: boolean) {
    set(sections.value.map((s) => (s.id === id ? { ...s, visible } : s)))
  }

  function move(fromIdx: number, toIdx: number) {
    const cur = sections.value.slice()
    if (fromIdx < 0 || fromIdx >= cur.length || toIdx < 0 || toIdx >= cur.length || fromIdx === toIdx) return
    const [moved] = cur.splice(fromIdx, 1)
    cur.splice(toIdx, 0, moved)
    set(cur)
  }

  cached = {
    sections,
    visibleIds,
    addable,
    labelFor,
    isVisible,
    remove: (id) => setVisible(id, false),
    add: (id) => setVisible(id, true),
    move,
    reset: () => set(defaultSections()),
  }
  return cached
}

// Test-only: clear the module singleton so each test mounts a fresh
// instance. Mirrors _resetDashboardLayoutForTest.
export function _resetSectionLayoutForTest(): void {
  cached = null
}
