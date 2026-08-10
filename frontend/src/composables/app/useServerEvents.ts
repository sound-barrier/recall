import { watchEffect } from 'vue'
import { storeToRefs } from 'pinia'

import { GetActiveParse, type MatchRecord } from '@/api-client'
import { useEventStream } from '@/composables/shared/useEventStream'
import { useParseRecovery } from '@/composables/ingest/useParseRecovery'
import { profileScopedKey } from '@/composables/shared/profileStorage'
import { currentSessionSummary } from '@/match/match-momentum-helpers'
import { queryClient } from '@/queries/client'
import { qk } from '@/queries/keys'
import { useMatchesStore } from '@/stores/matches'
import { useSettingsStore } from '@/stores/settings'

// App-shell wiring for the ingest event stream + parse-stream recovery.
// Both composables register component lifecycle hooks (onMounted /
// onBeforeUnmount), so they belong HERE — called from App.vue next to
// useAppBoot() — not inside a store, where they only worked by binding to
// App's lifecycle by accident (the smell frontend/CLAUDE.md documents).
// Event payloads land in the query cache (match-updated upserts through
// the store's writable records computed; tesseract-status through the
// settings cache write) or in the matches store's client refs.
export function useServerEvents() {
  const matchesStore = useMatchesStore()
  const settingsStore = useSettingsStore()
  const { records, parseProgress, parseLog, watchActivity, parseBusy } = storeToRefs(matchesStore)

  // parse-complete is the authoritative completion signal for EVERY parse
  // path (click, watcher, re-parse): the server emits it from the OCR
  // loop, so this owns clearing parseBusy + the reload.
  useEventStream({
    records,
    parseProgress,
    parseLog,
    watchActivity,
    onParseComplete: async () => {
      await matchesStore.load()
      // Read the fresh records straight from the cache — the observer's
      // reactive ref updates a notification tick later than the refetch
      // resolves, and the session summary must see the new batch.
      const fresh = queryClient.getQueryData<MatchRecord[]>(qk.matches) ?? []
      const session = currentSessionSummary(fresh)
      matchesStore.sessionToast = session ? { ...session, token: Date.now() } : null
      matchesStore.lastParsedAt = Date.now()
      try { localStorage.setItem(profileScopedKey('lastParsedAt'), String(matchesStore.lastParsedAt)) } catch (_) { /* non-fatal */ }
      matchesStore.parseBusy = false
      matchesStore.parseProgress = null
      matchesStore.cancellingParse = false
      const n = fresh.length
      matchesStore.announceParse(`Parse complete. ${n} match${n === 1 ? '' : 'es'} loaded.`)
    },
    onParseCancelled: async () => {
      await matchesStore.load()
      matchesStore.parseBusy = false
      matchesStore.cancellingParse = false
      matchesStore.parseProgress = null
      matchesStore.announceParse('Parse cancelled.')
    },
    // The backend probes Tesseract in the background after boot (so a
    // cold-boot Defender scan can't stall startup); push each result into
    // the settings store so the System Alert banner self-heals without an
    // app restart.
    onTesseractStatus: (s) => { settingsStore.setTesseractStatus(s) },
  })

  // Server-mode parse-stream recovery: detect a mid-parse SSE drop,
  // resync against GET /parses/active, surface a manual Refresh. No-op in
  // Wails. The active-parse snapshot goes through the cache with
  // staleTime 0 — always a real roundtrip, but concurrent resyncs
  // (mount + reconnect racing) join one request.
  const recovery = useParseRecovery({
    parseBusy,
    parseProgress,
    reload: matchesStore.load,
    getActiveParse: () => queryClient.fetchQuery({
      queryKey: qk.activeParse,
      queryFn: GetActiveParse,
      staleTime: 0,
    }),
  })
  watchEffect(() => { matchesStore.parseConnectionState = recovery.connectionState.value })
  matchesStore.wireParseRecovery({ refresh: recovery.refresh })
}
