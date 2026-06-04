// Per-widget configuration schema. Each WidgetDef declares a schema
// describing the knobs the user can tune from the gear-icon popover
// in edit mode. Schemas are declarative — fields list metadata; the
// schema's `validate` + `defaults` derive the rest. The popover
// auto-generates its form by walking `fields[]`.
//
// Why declarative + not Zod: this app doesn't already depend on a
// runtime validator, and the schemas we need (integer-choice, enum,
// boolean) fit a 60-line discriminated union without a dep. If we
// outgrow this we can swap to Zod without changing widget call
// sites — `makeSchema` is the only auto-derivation point.
//
// Storage contract: each widget's config persists as JSON at
// `localStorage['recall.dashboard.widget-config.<id>']`. `validate`
// narrows arbitrary decoded JSON back to the widget's typed config
// shape and falls back to per-field defaults for missing or
// type-mismatched values. This means a future schema migration that
// adds a new field is automatically backwards-compatible (the new
// field takes its default).

export type WidgetConfigField =
  | {
      kind:    'integer-choice'
      key:     string
      label:   string
      choices: readonly number[]
      default: number
    }
  | {
      kind:    'enum'
      key:     string
      label:   string
      choices: readonly { value: string; label: string }[]
      default: string
    }
  | {
      kind:    'boolean'
      key:     string
      label:   string
      default: boolean
    }

export interface WidgetConfigSchema<T extends Record<string, unknown>> {
  // The fields the popover renders + the user can set. Empty array
  // means "no knobs to configure" — DashboardWidget hides the gear
  // affordance entirely. The order is the popover's render order.
  fields: readonly WidgetConfigField[]
  // Narrows arbitrary decoded localStorage JSON to T. Any field that
  // fails its per-kind type check falls back to the schema default,
  // so a partial / corrupt stored value still round-trips into a
  // valid config. ALWAYS returns a valid T — never undefined.
  validate: (raw: unknown) => T
  // Returns the schema's defaults as a fresh T. Used by reset() and
  // as the seed for usePersistedRef when no value is stored yet.
  defaults: () => T
}

// EMPTY_SCHEMA is what every widget ships with on day one. Widgets
// that grow real knobs override their registry entry's `config`
// field with a `makeSchema([...])` call.
export const EMPTY_SCHEMA: WidgetConfigSchema<Record<string, unknown>> = {
  fields: [],
  validate: () => ({}),
  defaults: () => ({}),
}

// makeSchema auto-derives `validate` + `defaults` from a flat list
// of fields. Use this for widgets whose config is the straightforward
// "one value per field" shape. For schemas with cross-field
// constraints (e.g. "minMatches must be ≤ samplePool"), hand-roll
// the validator and pass it alongside `fields`.
export function makeSchema<T extends Record<string, unknown>>(
  fields: readonly WidgetConfigField[],
): WidgetConfigSchema<T> {
  function defaults(): T {
    const out: Record<string, unknown> = {}
    for (const f of fields) out[f.key] = f.default
    return out as T
  }
  function validate(raw: unknown): T {
    const defs = defaults()
    if (raw === null || typeof raw !== 'object') return defs
    const obj = raw as Record<string, unknown>
    const out: Record<string, unknown> = { ...defs }
    for (const f of fields) {
      const v = obj[f.key]
      if (isValidFieldValue(f, v)) out[f.key] = v
    }
    return out as T
  }
  return { fields, validate, defaults }
}

function isValidFieldValue(f: WidgetConfigField, v: unknown): boolean {
  switch (f.kind) {
    case 'integer-choice':
      return typeof v === 'number' && Number.isInteger(v) && f.choices.includes(v)
    case 'enum':
      return typeof v === 'string' && f.choices.some((c) => c.value === v)
    case 'boolean':
      return typeof v === 'boolean'
  }
}
