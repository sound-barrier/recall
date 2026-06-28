import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

import { OpenURL } from '@/api-client'
import { useAppStore } from '@/stores/app'
import { useUiStore } from '@/stores/ui'
import { DOCS_URL, ISSUES_URL } from '@/app-links'

// Behaviour for the masthead ⋮ application menu — the Chrome/Firefox-style app
// menu shown on the platforms WITHOUT a native menu bar (Windows, Linux, and
// the browser build). macOS gets the native menu bar instead
// (pkg/cmd/wails.go), so the kebab hides there to avoid duplicating it.
//
// The action handlers are the same ones the native menu's events drive
// (useNativeMenu), so the two surfaces stay in lockstep. Tab-switching is
// deliberately NOT here — the masthead nav tabs are visible on every platform,
// so listing them would duplicate what's already on screen (Chrome's ⋮ menu
// doesn't list tab-switching either).
export function useAppMenu() {
  const appStore = useAppStore()
  const uiStore = useUiStore()

  const open = ref(false)
  const triggerEl = ref<HTMLElement | null>(null)
  const menuEl = ref<HTMLElement | null>(null)

  // Hide on macOS-Wails (native menu bar present); show everywhere else.
  const isWails = typeof navigator !== 'undefined' && navigator.userAgent.includes('wails.io')
  const isMac = typeof navigator !== 'undefined'
    && /Mac/i.test(navigator.platform || navigator.userAgent || '')
  const showMenu = computed(() => !(isWails && isMac))

  function close() { open.value = false }
  function toggle() { open.value = !open.value }

  // Run an action and collapse the menu (every item is fire-and-close).
  function run(action: () => void) { action(); close() }
  const openAbout = () => run(() => appStore.openAbout())
  const openSettings = () => run(() => uiStore.openSettingsDialog())
  const openShortcuts = () => run(() => uiStore.openCheatsheet())
  const openDocs = () => run(() => OpenURL(DOCS_URL))
  const openIssues = () => run(() => OpenURL(ISSUES_URL))

  function onDocumentMousedown(e: MouseEvent) {
    if (!open.value) return
    const tgt = e.target as Node | null
    if (!tgt) return
    if (menuEl.value?.contains(tgt) || triggerEl.value?.contains(tgt)) return
    close()
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open.value) {
      close()
      triggerEl.value?.focus()
    }
  }
  onMounted(() => {
    document.addEventListener('mousedown', onDocumentMousedown)
    document.addEventListener('keydown', onKeydown)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onDocumentMousedown)
    document.removeEventListener('keydown', onKeydown)
  })

  return {
    open,
    triggerEl,
    menuEl,
    showMenu,
    toggle,
    close,
    openAbout,
    openSettings,
    openShortcuts,
    openDocs,
    openIssues,
  }
}
