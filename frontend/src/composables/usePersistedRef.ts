import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue'

// Custom event broadcast on every set() so OTHER instances of
// usePersistedRef sharing the same key re-hydrate in place. Lets
// the widget-config popover (PR D) save changes that the widget's
// own useWidgetConfig instance picks up reactively without coupling
// the two through a parent-level write path. The native 'storage'
// event would have worked between tabs, but doesn't fire for the
// originating document — hence the custom event.
const PREF_CHANGED_EVENT = 'recall-pref-changed'
interface PrefChangedDetail { key: string }

// usePersistedRef is the shared implementation behind the seven
// persisted-preference composables (useTheme, useWeekStart,
// useIncludeUndated, useDensityMode, useLeaverHandling,
// useMinPlayThreshold, useShowHidden). All seven used to copy the
// same shape: a ref + a set() that writes localStorage + an
// onMounted hydrate + an exported readStoredXxx() that other code
// could call without mounting. This factory collapses the closure
// part of that pattern.
//
// Per-composable wrappers still own their own `readStoredXxx()`
// exports so the public surface stays unchanged — the factory only
// DRYs the body. Adding a new persisted preference is a 5-line
// composable that delegates here, plus a per-composable readStored
// helper if one is genuinely useful outside the composable.
//
// Variations the factory supports:
// - boolean stored as "true"/"false" — `parseBoolish` covers this.
// - enum stored as itself — `parseEnum(...allowed)` covers this.
// - clamped number — `parseClampedNumber(min, max)` covers this.
// - DOM side effect on every change — the optional `onChange`
//   callback (used by useTheme to call applyTheme()).

export interface PersistedRefOptions<T> {
  key: string
  defaultValue: T
  // Returns the parsed value, or undefined to fall back to default.
  parse: (raw: string) => T | undefined
  // Defaults to String(v); override for boolean (true/false) or
  // any type whose `String()` representation doesn't round-trip.
  serialize?: (v: T) => string
  // Called both after the onMounted hydrate AND on every set().
  // Used by useTheme to push `data-theme` onto <html>.
  onChange?: (next: T) => void
}

export function usePersistedRef<T>(opts: PersistedRefOptions<T>): {
  value: Ref<T>
  set: (next: T) => void
} {
  const serialize = opts.serialize ?? ((v: T) => String(v))

  function readStored(): T {
    try {
      const raw = localStorage.getItem(opts.key)
      if (raw === null) return opts.defaultValue
      const parsed = opts.parse(raw)
      return parsed === undefined ? opts.defaultValue : parsed
    } catch (_) {
      return opts.defaultValue
    }
  }

  // Eager hydrate at setup time so the first render reflects the
  // persisted value. SSR / Node where localStorage doesn't exist
  // surfaces via the try/catch in readStored and falls back to
  // defaults; the onMounted block below re-runs the hydrate as a
  // safety net for callers wired before localStorage is available
  // (rare — vitest + happy-dom + Wails desktop all have localStorage
  // present at setup), and to fire onChange consistently.
  const value = ref(readStored()) as Ref<T>

  function set(next: T) {
    value.value = next
    let persisted = false
    try {
      localStorage.setItem(opts.key, serialize(next))
      persisted = true
    } catch (_) { /* quota exceeded, security error, non-browser env */ }
    opts.onChange?.(next)
    // Broadcast so sibling instances of the same key re-hydrate.
    // Only after a SUCCESSFUL persist — otherwise listeners would
    // re-read localStorage, miss the value (it never landed), fall
    // back to the default, and wipe the in-memory write the caller
    // just made. The originating instance keeps the value either
    // way because we wrote `value.value = next` first.
    if (!persisted) return
    try {
      window.dispatchEvent(
        new CustomEvent<PrefChangedDetail>(PREF_CHANGED_EVENT, {
          detail: { key: opts.key },
        }),
      )
    } catch (_) { /* non-browser env */ }
  }

  // Cross-instance sync: listen for set()s elsewhere with the same
  // key + re-read localStorage. Registered at setup so the listener
  // is in place for the very first render; cleaned up in
  // onBeforeUnmount so unmounted callers stop receiving events.
  const onPrefChanged = (e: Event) => {
    const detail = (e as CustomEvent<PrefChangedDetail>).detail
    if (detail?.key !== opts.key) return
    const hydrated = readStored()
    value.value = hydrated
    opts.onChange?.(hydrated)
  }
  try {
    window.addEventListener(PREF_CHANGED_EVENT, onPrefChanged)
  } catch (_) { /* non-browser env */ }

  onBeforeUnmount(() => {
    try {
      window.removeEventListener(PREF_CHANGED_EVENT, onPrefChanged)
    } catch (_) { /* non-browser env */ }
  })

  onMounted(() => {
    const hydrated = readStored()
    value.value = hydrated
    opts.onChange?.(hydrated)
  })

  return { value, set }
}

// ─── Parser helpers used by the wrapper composables ──────────────

// Parses a boolean stored as the literal strings "true" / "false".
// Anything else returns undefined → caller's defaultValue wins.
export function parseBoolish(raw: string): boolean | undefined {
  if (raw === 'true') return true
  if (raw === 'false') return false
  return undefined
}

// Serializes a boolean as the literal "true" / "false" string. The
// inverse of parseBoolish. The default String(true) → "true" already
// matches; explicit helper exists so the symmetry is obvious at the
// call site.
export function serializeBoolish(v: boolean): string {
  return v ? 'true' : 'false'
}

// parseEnum returns a parser that accepts only the listed values.
// Use for fixed-enum prefs (theme, week-start, density, leaver mode).
export function parseEnum<T extends string>(...allowed: readonly T[]): (raw: string) => T | undefined {
  const set = new Set<string>(allowed)
  return (raw: string) => (set.has(raw) ? (raw as T) : undefined)
}

// parseClampedNumber returns a parser that requires a finite numeric
// value, clamps to [min, max], and returns undefined for anything
// non-numeric so the caller's default wins.
export function parseClampedNumber(min: number, max: number): (raw: string) => number | undefined {
  return (raw: string) => {
    // Empty string is ambiguous (Number('') === 0) — treat it as
    // "no value" so the caller's defaultValue wins.
    if (raw === '') return undefined
    const n = Number(raw)
    if (!Number.isFinite(n)) return undefined
    if (n < min) return min
    if (n > max) return max
    return n
  }
}

// parseJsonRecord returns a parser that JSON-decodes a stored
// `Record<K, V>` and validates its shape via a predicate. Anything
// non-JSON, non-object, or shape-mismatched returns undefined →
// caller's defaultValue wins. Used for structured prefs (e.g. the
// row-keyed dashboard layout: { "1": ["a", "b"], "2": ["c"] }).
//
// The validator receives the decoded value typed as `unknown` so it
// can perform whatever depth of check the caller needs without
// forcing a narrow shape on this helper. Returning true commits the
// value at the parser's return type; returning false discards it.
export function parseJsonRecord<T>(validate: (decoded: unknown) => decoded is T): (raw: string) => T | undefined {
  return (raw: string) => {
    if (raw === '') return undefined
    let decoded: unknown
    try {
      decoded = JSON.parse(raw)
    } catch {
      return undefined
    }
    return validate(decoded) ? decoded : undefined
  }
}

// JSON-serialize a record. Mirror of parseJsonRecord; explicit so
// the symmetry reads at call sites.
export function serializeJsonRecord<T>(v: T): string {
  return JSON.stringify(v)
}
