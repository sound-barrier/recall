import { markRaw } from 'vue'
import { defineStore } from 'pinia'

import { useSelectedMatch } from '@/composables/matches/useSelectedMatch'
import { useScreenshotPreview } from '@/composables/shared/useScreenshotPreview'
import { useCardFocus } from '@/composables/matches/useCardFocus'
import { useMatchesStore } from '@/stores/matches'

// App-shell UI state: the right-side detail-panel selection, the
// source-screenshot preview/lightbox cache, and the j/k card-focus index.
// Migrated out of App.vue. Exposed as markRaw composable bundles — Pinia's
// reactive() store would otherwise deep-unwrap their inner refs (see the
// matches store's narrow cluster for the same gotcha); markRaw keeps the
// refs intact and reactive. Consumers destructure the bundle into top-level
// vars, same CardStateApi convention used across the app.
export const useUiStore = defineStore('ui', () => {
  const matchesStore = useMatchesStore()

  // Detail-panel selection paginates against the SAME narrowedRecords the
  // Matches view shows, so it tracks filter/hide/re-parse changes.
  const selection = useSelectedMatch(matchesStore.matchesNarrow.narrowedRecords)
  const preview = useScreenshotPreview()
  const cardFocus = useCardFocus()

  return {
    selection: markRaw(selection),
    preview: markRaw(preview),
    cardFocus: markRaw(cardFocus),
  }
})
