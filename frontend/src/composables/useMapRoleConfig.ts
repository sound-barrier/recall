import { computed, type ComputedRef } from 'vue'
import {
  usePersistedRef,
  parseJsonRecord,
  serializeJsonRecord,
} from './usePersistedRef'

// Display config for the Geography (Map × Role) band's gear. Lets the
// user narrow what the band RENDERS — which role rows, which map-type
// column groups, and/or which specific maps — without touching the
// global narrow or any other widget. Three independent filter sets,
// each "empty = show all"; non-empty selections AND together (a column
// shows only if its type passes the type filter AND its map passes the
// map filter; a row shows only if its role passes the role filter).
//
// Cached module singleton (like useSectionLayout) so the band and its
// gear popover mutate + read one reactive instance. Maps are stored by
// DISPLAY name — this is a view filter, not identity, so a stale name
// after an OW patch simply stops matching (the band degrades to its
// empty state, the user re-picks); no migration needed.

export type MapRole = 'tank' | 'dps' | 'support'

const ROLES: readonly string[] = ['tank', 'dps', 'support']
const MAP_TYPES: readonly string[] = ['control', 'escort', 'flashpoint', 'hybrid', 'push', 'clash']

export interface MapRoleConfig {
  roles: MapRole[]
  mapTypes: string[]
  maps: string[]
}

const DEFAULT: MapRoleConfig = { roles: [], mapTypes: [], maps: [] }
export const MAP_ROLE_CONFIG_KEY = 'recall.mapRole.config'

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

export function isMapRoleConfig(d: unknown): d is MapRoleConfig {
  return (
    d !== null &&
    typeof d === 'object' &&
    isStringArray((d as MapRoleConfig).roles) &&
    isStringArray((d as MapRoleConfig).mapTypes) &&
    isStringArray((d as MapRoleConfig).maps)
  )
}

// Drop values the app no longer recognises (role / type enums) and
// de-dupe; map names are left as-is (validated against the live roster
// at render time, not here).
export function reconcileMapRoleConfig(c: MapRoleConfig): MapRoleConfig {
  return {
    roles: [...new Set(c.roles)].filter((r): r is MapRole => ROLES.includes(r)),
    mapTypes: [...new Set(c.mapTypes)].filter((t) => MAP_TYPES.includes(t)),
    maps: [...new Set(c.maps)],
  }
}

export interface MapRoleConfigApi {
  config: ComputedRef<MapRoleConfig>
  // True when nothing is filtered — the band shows everything.
  isDefault: ComputedRef<boolean>
  toggleRole: (role: MapRole) => void
  toggleType: (type: string) => void
  toggleMap: (map: string) => void
  reset: () => void
}

let cached: MapRoleConfigApi | null = null

export function useMapRoleConfig(): MapRoleConfigApi {
  if (cached) return cached

  const { value: raw, set } = usePersistedRef<MapRoleConfig>({
    key: MAP_ROLE_CONFIG_KEY,
    defaultValue: { ...DEFAULT },
    parse: parseJsonRecord(isMapRoleConfig),
    serialize: serializeJsonRecord,
  })

  const config = computed(() => reconcileMapRoleConfig(raw.value))
  const isDefault = computed(() => {
    const c = config.value
    return c.roles.length === 0 && c.mapTypes.length === 0 && c.maps.length === 0
  })

  function toggle(list: readonly string[], value: string): string[] {
    return list.includes(value) ? list.filter((x) => x !== value) : [...list, value]
  }

  cached = {
    config,
    isDefault,
    toggleRole: (role) => set({ ...config.value, roles: toggle(config.value.roles, role) as MapRole[] }),
    toggleType: (type) => set({ ...config.value, mapTypes: toggle(config.value.mapTypes, type) }),
    toggleMap: (map) => set({ ...config.value, maps: toggle(config.value.maps, map) }),
    reset: () => set({ ...DEFAULT }),
  }
  return cached
}

// Test-only: clear the module singleton so each test starts fresh.
export function _resetMapRoleConfigForTest(): void {
  cached = null
}
