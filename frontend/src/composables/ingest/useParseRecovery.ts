import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

import { setEventStreamStatusHandler, type ActiveParse } from '@/api'
import type { ParseProgressEvent } from '@/components/ingest/ParseProgressPanel.vue'

// Parse-stream recovery for server mode. The parse runs server-side as a
// background job (POST /parses returns 202 up-front); progress +
// completion arrive over SSE, which does NOT replay on reconnect. This
// composable bridges the two failure modes a network blip introduces:
//
//   1. SSE drop mid-parse — the connection-status handler flips to
//      'reconnecting'; on re-open we resync against GET /parses/active
//      so a missed parse-complete (or progress) can't strand the panel.
//   2. Page reload mid-parse — onMounted resync restores the panel from
//      the same status endpoint.
//
// A watchdog escalates a persistent 'reconnecting' to 'lost' so the UI
// can offer a manual Refresh. In Wails mode the status handler never
// fires (no EventSource), so connectionState stays 'connected'.

export type ParseConnectionState = 'connected' | 'reconnecting' | 'lost'

export interface ParseRecoveryApi {
  // parse-busy + the live progress event — App.vue owns both; we set
  // them when resyncing against the server's run-state.
  parseBusy: Ref<boolean>
  parseProgress: Ref<ParseProgressEvent | null>
  // Re-fetch the matches list (App.vue's load()).
  reload: () => Promise<void> | void
  // GET /parses/active — the authoritative run-state snapshot.
  getActiveParse: () => Promise<ActiveParse>
  // How long a 'reconnecting' state may persist (while a parse is busy)
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
  // (reload-mid-parse), on reconnect, and on manual refresh.
  async function resync() {
    let active: ActiveParse
    try {
      active = await api.getActiveParse()
    } catch {
      return
    }
    if (active.running) {
      api.parseBusy.value = true
      api.parseProgress.value = {
        done: active.done,
        total: active.total,
        filename: '',
        screenshot_type: undefined,
      }
    } else if (api.parseBusy.value) {
      // We thought a parse was running but the server says it finished —
      // a parse-complete missed during the drop. Reload + clear.
      api.parseBusy.value = false
      api.parseProgress.value = null
      await api.reload()
    }
  }

  function onStatus(status: 'connected' | 'reconnecting') {
    if (status === 'reconnecting') {
      if (api.parseBusy.value) {
        if (connectionState.value === 'connected') connectionState.value = 'reconnecting'
        armStale()
      }
      return
    }
    // (re)connected
    const wasDisrupted = connectionState.value !== 'connected'
    connectionState.value = 'connected'
    clearStale()
    if (wasDisrupted) void resync()
  }

  // A fresh parse-progress tick proves the stream is delivering again —
  // clear any reconnecting/lost state even before the next onopen.
  watch(api.parseProgress, () => {
    if (connectionState.value !== 'connected') {
      connectionState.value = 'connected'
      clearStale()
    }
  })

  // Manual fallback (the Refresh button): re-pull the run-state + reset.
  function refresh() {
    connectionState.value = 'connected'
    clearStale()
    void resync()
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
