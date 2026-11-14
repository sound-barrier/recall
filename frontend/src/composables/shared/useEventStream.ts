import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { EventsOn, EventsOff, type MatchRecord, type RunFinishedEvent, type TesseractStatus } from '@/api-client'
import type { ParseProgressEvent, WatchActivityEvent } from '@/components/ingest/parse-progress'

// Live-stream subscriptions for the events the backend emits: the run's
// progress ticks and its end, the per-record match-updated upserts, and the
// smaller state pushes (Tesseract probe, coach session, watcher tally).
// Payloads are handed on as they arrive; the parse store's run machine
// decides what a progress tick or a run's end means.

export interface EventStreamApi {
  // Returns the current records list. Required for the upsert path.
  records: Ref<MatchRecord[]>
  onParseProgress: (event: ParseProgressEvent) => void
  // Called exactly once per run, however it ended.
  onRunFinished: (event: RunFinishedEvent) => void
  // Watcher pending-file tally for the masthead dot. Optional - absent
  // consumers simply never see watch-activity payloads.
  watchActivity?: Ref<WatchActivityEvent | null>
  // Called when the backend's background Tesseract probe publishes a fresh
  // status (a cold-boot Defender scan finally let the binary run). Lets the
  // engine banner self-heal without an app restart.
  onTesseractStatus?: (status: TesseractStatus) => void
  // Called when a coaching session opens or closes in ANOTHER window on
  // this install. Both windows share one backend, so the one that did not
  // open the session still has to lock its writes.
  onCoachSessionChanged?: (active: boolean) => void
}

export function useEventStream(api: EventStreamApi) {
  function onMatchUpdated(rec: MatchRecord | null) {
    if (!rec || !rec.match_key) return
    const i = api.records.value.findIndex(r => r.match_key === rec.match_key)
    if (i >= 0) {
      api.records.value = [
        ...api.records.value.slice(0, i),
        rec,
        ...api.records.value.slice(i + 1),
      ]
    } else {
      api.records.value = [...api.records.value, rec]
    }
  }

  function subscribe() {
    EventsOn<ParseProgressEvent>('parse-progress', (data) => {
      if (data) api.onParseProgress(data)
    })
    EventsOn<RunFinishedEvent>('run-finished', (data) => {
      if (data) api.onRunFinished(data)
    })
    // Live-stream MatchRecords. Upsert by match_key into the same
    // records ref the static loader populates — every downstream
    // filter/group/render computed recomputes for free. A run's end
    // reloads the list as the authoritative reconciliation in case any of
    // these events were dropped on a slow SSE connection.
    EventsOn<MatchRecord>('match-updated', onMatchUpdated)
    // Background Tesseract probe result — refresh the engine status so the
    // System Alert clears itself once a cold-boot scan releases the binary.
    EventsOn<TesseractStatus>('tesseract-status', (s) => {
      if (s) api.onTesseractStatus?.(s)
    })
    // A coaching session opened or ended — possibly in another window.
    EventsOn<{ active?: boolean }>('coach-session-changed', (ev) => {
      api.onCoachSessionChanged?.(ev?.active === true)
    })
    // Watcher pending-file tally - the masthead's "watching · N new" dot.
    EventsOn<WatchActivityEvent>('watch-activity', (ev) => {
      if (ev && api.watchActivity) api.watchActivity.value = ev
    })
  }

  function unsubscribe() {
    EventsOff('parse-progress')
    EventsOff('run-finished')
    EventsOff('match-updated')
    EventsOff('tesseract-status')
    EventsOff('coach-session-changed')
    EventsOff('watch-activity')
  }

  onMounted(subscribe)
  onBeforeUnmount(unsubscribe)

  // Exposed for tests so subscriptions can be driven directly
  // without faking the EventsOn/Off bridge.
  return { onMatchUpdated, subscribe, unsubscribe }
}
