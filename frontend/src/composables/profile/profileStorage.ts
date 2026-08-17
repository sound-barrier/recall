// Per-profile localStorage scoping. Keys that reference a profile's
// DATA — the since-anchor match_key, the last-parse timestamp — must
// not be shared across profiles: profile A's anchor names a match that
// exists only in A's database, so carrying it into profile B filters
// against nothing (or the wrong match). Device-level preferences
// (theme, week start, layouts) stay on plain `recall.*` keys.
//
// The scope derives from a synchronously-readable cache of the active
// profile name rather than the profiles API because persisted-pref
// composables hydrate at setup time, before any API call resolves.
// The cache is written wherever the app learns or changes the active
// profile: the masthead switcher's refresh, and each reload-triggering
// profile mutation just before its `location.reload()`. Worst case a
// stale cache mis-scopes one session after an out-of-band profile
// change; the next boot's refresh self-heals it.
//
// Versioning note (the other half of the ledger entry): structured
// prefs self-version through their parse validators — an unreadable
// or shape-mismatched value falls back to the default (see
// usePersistedRef's parse contract; `recall.dashboard.layoutVersion`
// is the explicit-version exemplar). New keys need no global scheme.

export const ACTIVE_PROFILE_CACHE_KEY = 'recall.activeProfile'

// pkg/app/profile.go's DefaultProfileName — the profile every fresh
// install runs as until renamed, and the correct owner of any state
// written before the cache first exists.
const DEFAULT_PROFILE = 'main'

// cacheActiveProfile records the active profile name for synchronous
// key scoping. Empty names are ignored so a failed profiles lookup
// can't poison the scope. Best-effort: private-mode localStorage
// failures leave the previous scope in place.
export function cacheActiveProfile(name: string): void {
  if (!name) return
  try { localStorage.setItem(ACTIVE_PROFILE_CACHE_KEY, name) } catch (_) { /* keep prior scope */ }
}

// profileScopedKey builds the per-profile localStorage key for a
// suffix: `recall.profiles.<active>.<suffix>`.
export function profileScopedKey(suffix: string): string {
  let active = ''
  try { active = localStorage.getItem(ACTIVE_PROFILE_CACHE_KEY) ?? '' } catch (_) { /* fall through */ }
  return `recall.profiles.${active || DEFAULT_PROFILE}.${suffix}`
}
