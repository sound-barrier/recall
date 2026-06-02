import { ref, onMounted, type Ref } from 'vue'

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
  const value = ref(opts.defaultValue) as Ref<T>
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

  function set(next: T) {
    value.value = next
    try { localStorage.setItem(opts.key, serialize(next)) } catch (_) {}
    opts.onChange?.(next)
  }

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

// Parses a comma-delimited list of non-empty strings. Empty input
// returns []; corrupted (non-string somehow) returns undefined →
// caller's defaultValue wins. Whitespace around each entry is
// trimmed and empty entries are dropped — so a stale `",,"` from a
// partial write reads as [] and doesn't break the reader. Use for
// unbounded ordered string lists (e.g. dashboard hidden-set).
export function parseStringArray(raw: string): string[] | undefined {
  if (typeof raw !== 'string') return undefined
  if (raw === '') return []
  return raw.split(',').map((s) => s.trim()).filter((s) => s !== '')
}

// Inverse of parseStringArray. Drops empties + dedupes on write so
// the persisted form is always canonical.
export function serializeStringArray(v: readonly string[]): string {
  return Array.from(new Set(v.filter((s) => s !== ''))).join(',')
}
