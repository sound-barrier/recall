import { usePersistedRef, parseEnum } from './usePersistedRef'

export type ThemeMode = 'dark' | 'light'
export const THEME_STORAGE_KEY = 'recall.theme'

const parseTheme = parseEnum<ThemeMode>('dark', 'light')

// Reads the persisted theme preference, falling back to 'dark'.
export function readStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return parseTheme(stored ?? '') ?? 'dark'
  } catch (_) {
    return 'dark'
  }
}

// Sets data-theme on the document root, scoping light-mode CSS overrides.
export function applyTheme(mode: ThemeMode): void {
  document.documentElement.setAttribute('data-theme', mode)
}

export function useTheme() {
  // applyTheme runs on both the onMounted hydrate AND every set(),
  // so the <html data-theme> attribute always reflects the ref.
  const { value: themeMode, set: setTheme } = usePersistedRef<ThemeMode>({
    key: THEME_STORAGE_KEY,
    defaultValue: 'dark',
    parse: parseTheme,
    onChange: applyTheme,
  })

  function toggleTheme() {
    setTheme(themeMode.value === 'dark' ? 'light' : 'dark')
  }

  return { themeMode, toggleTheme }
}
