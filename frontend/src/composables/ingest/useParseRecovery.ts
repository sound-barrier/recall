import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

import { setEventStreamStatusHandler, type ActiveRun } from '@/api-client'
import type { ParseProgressEvent } from '@/components/ingest/parse-progress'

// Parse-stream recovery for server mode. The parse runs server-side as a
// background job (POST /parses returns 202 up-front); progress +
// completion arrive over SSE, which does NOT replay on reconnect. This
// composable bridges the two failure modes a network blip introduces:
//
//   1. SSE drop — the connection-status handler flips to 'reconnecting';
//      on re-open we resync against GET /parses/active so a missed
//      run-finished (or progress) can't strand the panel, and reload the
//      matches so any match-updated lost in the gap is reconciled — idle
//      or not, since the folder watcher runs while nobody is looking.
//   2. Page reload mid-parse — onMounted resync restores the panel from
//      the same status endpoint.
//
// A watchdog escalates a persistent 'reconnecting' to 'lost' so the UI
// can offer a manual Refresh. In Wails mode the status handler never
// fires (no EventSource), so connectionState stays 'connected'.

export type ParseConnectionState = 'connected' | 'reconnecting' | 'lost'

export interface ParseRecoveryApi {
  // Whether a run holds the slot — the 'lost' escalation only matters then.
  parseBusy: Ref<boolean>
  // The live progress tick; a fresh one proves the stream is delivering.
  parseProgress: Ref<ParseProgressEvent | null>
  // Re-fetch the matches list (the matches store's load()).
  reload: () => Promise<void> | void
  // GET /parses/active — the authoritative run-slot snapshot.
  getActiveParse: () => Promise<ActiveRun>
  // The run machine's generation now, and the door a snapshot read at a
  // generation goes back through — the machine drops it if the run moved
  // while the read was in flight.
  runGeneration: () => number
  applySnapshot: (active: ActiveRun, generation: number) => void
  // How long a 'reconnecting' state may persist (while a run is busy)
  // before escalating to 'lost' + the manual Refresh. Overridable for
  // tests; defaults to 8s.
  staleMs?: number
}

export function useParseRecovery(api: ParseRecoveryApi) {
  const connectionState = ref<ParseConnectionState>('connected')
  const staleMs = api.staleMs ?? 8000
  let staleTimer: ReturnType<typeof setTimeout> | null = null

  function clearStale() {
    if (staleTimer) {
      clearTimeout(staleTimer)
      staleTimer = null
    }
  }

  function armStale() {
    clearStale()
    staleTimer = setTimeout(() => {
      if (api.parseBusy.value) connectionState.value = 'lost'
    }, staleMs)
  }

  // Heal the UI from the authoritative run-state. Used on mount
  // (reload-mid-parse), on reconnect, and on manual refresh. Returns
  // whether the snapshot was read.
  async function resync(): Promise<boolean> {
    const generation = api.runGeneration()
    let active: ActiveRun
    try {
      active = await api.getActiveParse()
    } catch {
      return false
    }
    api.applySnapshot(active, generation)
    return true
  }

  function onStatus(status: 'connected' | 'reconnecting') {
    if (status === 'reconnecting') {
      if (connectionState.value === 'connected') connectionState.value = 'reconnecting'
      if (api.parseBusy.value) armStale()
      return
    }
    // (re)connected
    const wasDisrupted = connectionState.value !== 'connected'
    connectionState.value = 'connected'
    clearStale()
    if (wasDisrupted) {
      void resync()
      void api.reload()
    }
  }

  // A fresh parse-progress tick proves the stream is delivering again —
  // clear any reconnecting/lost state even before the next onopen.
  watch(api.parseProgress, () => {
    if (connectionState.value !== 'connected') {
      connectionState.value = 'connected'
      clearStale()
    }
  })

  // Manual fallback (the Refresh button): re-pull the run-state. The
  // state reads 'connected' only once the server has answered.
  async function refresh() {
    clearStale()
    if (await resync()) connectionState.value = 'connected'
  }

  onMounted(() => {
    setEventStreamStatusHandler(onStatus)
    void resync()
  })
  onBeforeUnmount(() => {
    setEventStreamStatusHandler(null)
    clearStale()
  })

  return { connectionState, refresh }
}
