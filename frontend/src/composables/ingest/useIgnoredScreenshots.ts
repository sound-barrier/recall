import { computed, ref } from 'vue'

import {
  ClearIgnoredScreenshots,
  GetIgnoredScreenshots,
  UnignoreScreenshot,
  type IgnoredScreenshot,
} from '@/api'
import type { TabId } from '@/composables/shared/useTabKeyboardNav'

// Ignored-screenshots panel state + actions — the suppress-list a user builds
// from the Unknown tab, the count chip the Parse view shows, and the
// restore/clear/re-parse actions the panel fires. Extracted from App.vue
// (REVIEW.md Q13); the few cross-cutting App.vue concerns it needs
// (error surface, view nav, the manual-parse kick) are injected.
export interface IgnoredScreenshotsDeps {
  // App.vue's setErrorFromRaw — surfaces a restore/clear failure.
  onError: (raw: string) => void
  // Switch the active view (used by "Run Parse now" → Parse tab).
  goToView: (tab: TabId) => unknown
  // Kick the existing manual-parse flow.
  parse: () => unknown
}

export function useIgnoredScreenshots(deps: IgnoredScreenshotsDeps) {
  const ignoredScreenshots = ref<IgnoredScreenshot[]>([])
  const ignoredCount = computed(() => ignoredScreenshots.value.length)
  const ignoredPanelOpen = ref(false)

  async function loadIgnored() {
    try {
      ignoredScreenshots.value = await GetIgnoredScreenshots()
    } catch (e) {
      // Best-effort — failing to refresh the count shouldn't block the primary
      // record reload that triggered us.
      console.warn('GetIgnoredScreenshots failed:', e)
    }
  }

  function openIgnoredPanel() {
    ignoredPanelOpen.value = true
  }

  function closeIgnoredPanel() {
    ignoredPanelOpen.value = false
  }

  // Per-row Restore from the panel. Removes the file from the suppress-list and
  // refreshes the list — the next Parse run re-discovers the file from disk.
  async function onUnignoreScreenshot(filename: string) {
    try {
      await UnignoreScreenshot(filename)
      await loadIgnored()
    } catch (e) {
      deps.onError(String(e))
    }
  }

  // Bulk Re-enable all — truncates the suppress-list in one call.
  async function onClearIgnoredScreenshots() {
    try {
      await ClearIgnoredScreenshots()
      await loadIgnored()
    } catch (e) {
      deps.onError(String(e))
    }
  }

  // "Run Parse now" link inside the panel — close the modal, switch to the
  // Parse tab, and kick the existing manual-parse flow.
  function onRunParseFromIgnored() {
    closeIgnoredPanel()
    deps.goToView('ingest')
    void deps.parse()
  }

  return {
    ignoredScreenshots,
    ignoredCount,
    ignoredPanelOpen,
    loadIgnored,
    openIgnoredPanel,
    closeIgnoredPanel,
    onUnignoreScreenshot,
    onClearIgnoredScreenshots,
    onRunParseFromIgnored,
  }
}
