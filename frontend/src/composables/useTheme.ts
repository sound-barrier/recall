import { usePersistedRef, parseEnum } from './usePersistedRef'

// Two theme families share one preference slot:
//
//   - "Recall" family: dark / light / high-contrast — editorial
//     cream-and-rust light + photographer's-darkroom dark plus a
//     tournament-booth contrast variant.
//   - "OW" family: ow-light / ow-dark — palettes lifted directly from
//     the Overwatch UI. ow-light grounds on Overwatch white (cream-
//     paper that matches the post-match summary screen); ow-dark
//     grounds on the brand gray (#4A4A4A) that Blizzard uses for the
//     in-game scoreboard plate. Both keep the same OW orange accent
//     so cross-theme transitions feel cohesive.
//
// All five share one localStorage key — the user picks one preference,
// the rest live in the Appearance picker.
export type ThemeMode = 'dark' | 'light' | 'high-contrast' | 'ow-light' | 'ow-dark'
export const THEME_STORAGE_KEY = 'recall.theme'

const parseTheme = parseEnum<ThemeMode>('dark', 'light', 'high-contrast', 'ow-light', 'ow-dark')

// detectSystemPreference reads the OS-level light/dark preference via
// matchMedia. Used as the fresh-install fallback so a user running
// their OS in light mode doesn't land on a dark UI by default. Never
// returns 'high-contrast' or an OW variant — those are opt-in only
// because OSes don't expose a granular "I want a tournament-booth UI"
// or "OW-styled chrome" signal, and `forced-colors: active` is a
// separate concept (system high-contrast for AT, not a stylistic
// pick). First launch lands on "dark" or "light"; the OW palettes
// require an explicit pick.
export function detectSystemPreference(): Exclude<ThemeMode, 'high-contrast' | 'ow-light' | 'ow-dark'> {
  try {
    if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch (_) {
    return 'dark'
  }
}

// Reads the persisted theme preference. Falls through to the OS
// preference on a fresh install (no value stored). Once the user has
// picked anything via the Settings → Appearance swatches, that
// choice persists across launches AND reinstalls (localStorage lives
// outside the app bundle on every supported platform).
export function readStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return parseTheme(stored ?? '') ?? detectSystemPreference()
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
