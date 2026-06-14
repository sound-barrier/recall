import { computed, type ComputedRef } from 'vue'
import { usePersistedRef, serializeJsonRecord } from '@/composables/shared/usePersistedRef'
import type { WidgetConfigSchema } from '@/dashboard/widget-config-schema'

// useWidgetConfig persists a widget's typed config to localStorage
// under `recall.dashboard.widget-config.<id>` and returns a reactive
// view of the current value. Mirrors the persisted-preference family
// pattern (`useTheme`, `useWeekStart`, `useIncludeUndated`, …) but
// keyed on a widget id so multiple widget instances of different
// kinds don't collide.
//
// Storage scope is GLOBAL — matches `recall.dashboard.layout`. If
// per-profile widget config becomes a real need, the key prefix can
// grow a profile segment without changing this surface.
//
// The composable owns the JSON round-trip; widgets consume only the
// `config` ComputedRef. `set(patch)` merges shallow-style: only the
// listed keys overwrite the stored value, so a popover saving a
// single field never clobbers neighbouring fields. `reset()` writes
// the schema defaults so a future schema migration that changes a
// default propagates to reset users on next hydrate (we don't
// removeItem because reset should be EXPLICIT user intent — "I want
// these specific values", not "fall back to whatever the current
// release ships").

export interface UseWidgetConfigReturn<T extends Record<string, unknown>> {
  // Reactive view of the current validated config.
  config: ComputedRef<T>
  // Merge a partial update + persist. Pre-existing keys not in the
  // patch are preserved. Schema-invalid values would round-trip
  // through `validate` on the next hydrate, but ideally the popover
  // only feeds it values from the field's `choices` list.
  set: (patch: Partial<T>) => void
  // Write the schema defaults + persist. Explicit user intent.
  reset: () => void
}

export function useWidgetConfig<T extends Record<string, unknown>>(
  id: string,
  schema: WidgetConfigSchema<T>,
): UseWidgetConfigReturn<T> {
  const key = `recall.dashboard.widget-config.${id}`
  const { value: stored, set: setStored } = usePersistedRef<T>({
    key,
    defaultValue: schema.defaults(),
    parse: (raw: string) => {
      if (raw === '') return undefined
      let decoded: unknown
      try {
        decoded = JSON.parse(raw)
      } catch {
        return undefined
      }
      // schema.validate ALWAYS returns a valid T — corrupt fields
      // get repaired to their per-field defaults. Returning the
      // repaired value commits the corrected shape on next set,
      // self-healing the localStorage entry.
      return schema.validate(decoded)
    },
    serialize: serializeJsonRecord,
  })

  const config = computed<T>(() => stored.value)

  function set(patch: Partial<T>): void {
    setStored({ ...stored.value, ...patch } as T)
  }

  function reset(): void {
    setStored(schema.defaults())
  }

  return { config, set, reset }
}
