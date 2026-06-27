import { onMounted, onBeforeUnmount } from 'vue'

import { EventsOn, EventsOff } from '@/api-client'
import { useAppStore } from '@/stores/app'
import { useUiStore } from '@/stores/ui'

// Bridges the native macOS menu bar (pkg/cmd/wails.go) to the in-app dialogs.
// Each menu item's Go callback emits a `menu:*` Wails event; this listens and
// runs the SAME store action the ⋮ kebab does, so the two surfaces stay in
// lockstep. macOS-only in practice (the native menu is only built there), but
// harmless everywhere else — the events simply never fire.
const MENU_EVENTS = ['menu:about', 'menu:settings', 'menu:shortcuts', 'menu:view'] as const

export function useNativeMenu() {
  const appStore = useAppStore()
  const uiStore = useUiStore()

  onMounted(() => {
    EventsOn('menu:about', () => appStore.openAbout())
    EventsOn('menu:settings', () => uiStore.openSettingsDialog())
    EventsOn('menu:shortcuts', () => uiStore.openCheatsheet())
    EventsOn<string>('menu:view', (tab) => {
      if (typeof tab === 'string' && tab) void appStore.goToView(tab)
    })
  })
  onBeforeUnmount(() => {
    for (const name of MENU_EVENTS) EventsOff(name)
  })
}
