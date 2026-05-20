import { ref, onMounted } from 'vue'

export type ThemeMode = 'dark' | 'light'
export const THEME_STORAGE_KEY = 'recall.theme'

// Reads the persisted theme preference, falling back to 'dark'.
// Exported so it can be tested without a mounted component.
export function readStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch (_) {}
  return 'dark'
}

// Sets data-theme on the document root, scoping light-mode CSS overrides.
// Exported so it can be tested without a mounted component.
export function applyTheme(mode: ThemeMode): void {
  document.documentElement.setAttribute('data-theme', mode)
}

export function useTheme() {
  const themeMode = ref<ThemeMode>('dark')

  function toggleTheme() {
    themeMode.value = themeMode.value === 'dark' ? 'light' : 'dark'
    applyTheme(themeMode.value)
    try { localStorage.setItem(THEME_STORAGE_KEY, themeMode.value) } catch (_) {}
  }

  onMounted(() => {
    themeMode.value = readStoredTheme()
    applyTheme(themeMode.value)
  })

  return { themeMode, toggleTheme }
}
