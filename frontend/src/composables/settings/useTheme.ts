import { usePersistedRef, parseEnum } from '@/composables/shared/usePersistedRef'

// Four themes share one preference slot:
//
//   - day             grounds on Overwatch white (#efede6, post-match
//                     summary cream). Brand-gray borders, OW orange
//                     accent. The light family.
//   - dark            grounds on OW brand gray #4A4A4A (in-game
//                     scoreboard plate). Surfaces step UP in luminance
//                     so cards rise off the page like the OW plate
//                     stack. Orange-tinted borders.
//   - night           the editorial photographer's-darkroom palette —
//                     deep blue-charcoal #0a0b0d with bright-orange
//                     highlights. The :root CSS block carries this
//                     palette as the cascade default, so data-theme=
//                     "night" intentionally falls through without a
//                     scoped override.
//   - high-contrast   tournament-booth / low-vision variant. Pure
//                     black ground, pure white text, boosted gold.
//
// All four share one localStorage key (THEME_STORAGE_KEY).
export type ThemeMode = 'day' | 'dark' | 'night' | 'high-contrast'
export const THEME_STORAGE_KEY = 'recall.theme'

// Legacy storage migrations. Recall went through one rename of the
// theme set; users who picked a theme under the old names get mapped
// to the closest match under the new names so their preference
// survives the upgrade. Hand-curated.
//
// The editorial "light" (cream/rust) theme was removed entirely;
// its closest survivor is "day" (the OW White light variant). The
// OW namespace collapses into the neutral "day" / "dark" names
// since the OW palettes are now the only light / dark options.
//
// "dark" intentionally does NOT migrate — the string is reused by
// the new OW-gray theme. Pre-rename users who explicitly picked the
// editorial-darkroom "dark" silently land on the new OW-gray "dark"
// palette. Both are dark surfaces; the visual delta is mild and
// the alternative (migrating "dark" → "night") would break every
// post-rename "dark" pick, which is a much louder regression.
const LEGACY_MIGRATIONS: Record<string, ThemeMode> = {
  light: 'day',
  'ow-light': 'day',
  'ow-dark': 'dark',
}

// parseTheme accepts a stored string and returns the ThemeMode it
// resolves to (post-migration), or undefined if it's neither a
// current mode nor a known legacy alias. Wired into usePersistedRef
// as the parse seam so migration runs on every hydrate without the
// composable having to opt in.
const parseValidTheme = parseEnum<ThemeMode>('day', 'dark', 'night', 'high-contrast')
const parseTheme = (raw: string): ThemeMode | undefined => {
  const migrated = LEGACY_MIGRATIONS[raw] ?? raw
  return parseValidTheme(migrated)
}

// detectSystemPreference reads the OS-level light/dark preference via
// matchMedia. Used as the fresh-install fallback so a user running
// their OS in light mode doesn't land on a dark UI by default.
// `prefers-color-scheme: dark` resolves to the OW-gray 'dark' palette
// (the in-game scoreboard plate look), not the editorial 'night'
// darkroom. Rationale: 'dark' is the system-dark expectation users
// bring from other Mac/Windows/Linux apps — neutral surfaces with
// raised cards — whereas 'night' is a deliberate atmospheric pick
// (deep blue-charcoal with bright-orange highlights) that should
// require opt-in. Never returns 'high-contrast' — that's a
// `forced-colors: active` / AT concept, separate from the stylistic
// pick. First launch lands on 'day' or 'dark'; 'night' and
// 'high-contrast' require an explicit pick via Settings → Appearance.
export function detectSystemPreference(): Exclude<ThemeMode, 'high-contrast' | 'night'> {
  try {
    if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'day'
  } catch (_) {
    return 'dark'
  }
}

// Reads the persisted theme preference. Falls through to the OS
// preference on a fresh install (no value stored). Legacy stored
// values (from the previous theme set) are silently migrated to
// the closest equivalent. Once the user has picked anything via the
// Settings → Appearance swatches, that choice persists across
// launches AND reinstalls (localStorage lives outside the app
// bundle on every supported platform).
export function readStoredTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY) ?? ''
    const migrated = LEGACY_MIGRATIONS[raw] ?? raw
    return parseTheme(migrated) ?? detectSystemPreference()
  } catch (_) {
    return detectSystemPreference()
  }
}

// Sets data-theme on the document root, scoping per-mode CSS overrides.
export function applyTheme(mode: ThemeMode): void {
  document.documentElement.setAttribute('data-theme', mode)
}

export function useTheme() {
  // applyTheme runs on both the onMounted hydrate AND every set(),
  // so the <html data-theme> attribute always reflects the ref.
  const { value: themeMode, set: setTheme } = usePersistedRef<ThemeMode>({
    key: THEME_STORAGE_KEY,
    defaultValue: detectSystemPreference(),
    parse: parseTheme,
    onChange: applyTheme,
  })

  return { themeMode, setTheme }
}
