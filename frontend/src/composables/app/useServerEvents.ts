import { computed } from 'vue'
import { storeToRefs } from 'pinia'

import { GetActiveParse, type MatchRecord } from '@/api-client'
import { useEventStream } from '@/composables/shared/useEventStream'
import { useParseRecovery } from '@/composables/ingest/useParseRecovery'
import { getQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'
import { useCoachStore } from '@/stores/coach'
import { useMatchesStore } from '@/stores/matches'
import { useParseStore } from '@/stores/parse'
import { useSettingsStore } from '@/stores/settings'

// App-shell wiring for the ingest event stream + parse-stream recovery.
// Both composables register component lifecycle hooks (onMounted /
// onBeforeUnmount), so they belong HERE — called from App.vue next to
// useAppBoot() — not inside a store, where they only worked by binding to
// App's lifecycle by accident (the smell frontend/CLAUDE.md documents).
// This file only WIRES: the parse-lifecycle transitions are store actions
// (finishParseRun), and event payloads land in the query cache or the
// parse store's client refs.
export function useServerEvents() {
  const matchesStore = useMatchesStore()
  const parseStore = useParseStore()
  const settingsStore = useSettingsStore()
  const { parseProgress, parseLog, watchActivity, parseBusy } = storeToRefs(parseStore)

  // The match-updated upsert target reads/writes the qk.matches CACHE
  // directly — never the store's tour-aware `records` computed, whose
  // getter would hand the upsert the demo overlay (or a not-yet-loaded
  // empty list) to write back as real data, and whose setter cancels
  // in-flight fetches (right for test seeding, wrong here: a mid-boot
  // upsert must not kill the authoritative GET). parse-complete's refetch
  // remains the reconciliation for any racing writes.
  const upsertTarget = computed<MatchRecord[]>({
    get: () => getQueryClient().getQueryData<MatchRecord[]>(qk.matches) ?? [],
    set: (next) => { getQueryClient().setQueryData(qk.matches, next) },
  })

  useEventStream({
    records: upsertTarget,
    parseProgress,
    parseLog,
    watchActivity,
    onParseComplete: () => parseStore.finishParseRun('complete'),
    onParseCanceled: () => parseStore.finishParseRun('canceled'),
    // The backend probes Tesseract in the background after boot (so a
    // cold-boot Defender scan can't stall startup); push each result into
    // the settings store so the System Alert banner self-heals without an
    // app restart.
    onTesseractStatus: (s) => { settingsStore.setTesseractStatus(s) },
    // A coaching session opened or ended — possibly in another window.
    // The write gate reads sessionActive, so this is what keeps a second
    // window from offering edits the server is about to refuse.
    onCoachSessionChanged: (active) => { void useCoachStore().onSessionChangedElsewhere(active) },
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
    getActiveParse: () => getQueryClient().fetchQuery({
      queryKey: qk.activeParse,
      queryFn: GetActiveParse,
      staleTime: 0,
    }),
  })
  parseStore.wireParseRecovery(recovery)
}
