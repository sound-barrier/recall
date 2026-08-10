import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { EventsOn, EventsOff, type MatchRecord, type TesseractStatus } from '@/api-client'
import type { ParseProgressEvent, WatchActivityEvent } from '@/components/ingest/parse-progress'

// Live-stream subscriptions for the three SSE events emitted during
// ingest: parse-progress (per-file ticks), parse-complete (batch
// done), and match-updated (per-record live-stream).
//
// Extracted from App.vue because the three subscriptions, the
// rolling 50-entry log buffer, the parse-complete-driven reload,
// and the match-updated upsert-by-key all live in one place; the
// inline implementation was the largest non-handler block in the
// onMounted body.

export interface EventStreamApi {
  // Returns the current records list. Required for the upsert path.
  records: Ref<MatchRecord[]>
  parseProgress: Ref<ParseProgressEvent | null>
  parseLog: Ref<ParseProgressEvent[]>
  // Watcher pending-file tally for the masthead dot. Optional - absent
  // consumers simply never see watch-activity payloads.
  watchActivity?: Ref<WatchActivityEvent | null>
  // Called when a parse batch finishes. Should reload records and
  // refresh whatever the caller wants invalidated.
  onParseComplete: () => Promise<void> | void
  // Called when a parse run was aborted via CancelParse. Distinct
  // hook so the consumer can flip a "canceling…" state back to
  // idle, render different toast copy, etc. Optional — if absent,
  // parse-canceled is treated the same as parse-complete (still
  // safe; the records ref reflects the partial state).
  onParseCanceled?: () => Promise<void> | void
  // Called when the backend's background Tesseract probe publishes a fresh
  // status (a cold-boot Defender scan finally let the binary run). Lets the
  // engine banner self-heal without an app restart.
  onTesseractStatus?: (status: TesseractStatus) => void
  // Maximum entries in the rolling log (default 50).
  logCap?: number
}

const DEFAULT_LOG_CAP = 50

export function useEventStream(api: EventStreamApi) {
  const cap = api.logCap ?? DEFAULT_LOG_CAP

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
    EventsOn('parse-complete', () => { void api.onParseComplete() })
    EventsOn('parse-progress', (data: ParseProgressEvent | null) => {
      if (!data) return
      api.parseProgress.value = data
      api.parseLog.value = [...api.parseLog.value, data].slice(-cap)
    })
    // parse-canceled is the third terminal lifecycle event (the
    // other two are parse-complete and the implicit
    // "no-more-progress-ticks"). The records ref already reflects
    // any partial state because the per-file inserts ran inside the
    // OCR callback; the consumer just needs to know to flip the
    // Stop button + "canceling…" indicator back to idle.
    EventsOn('parse-canceled', () => {
      if (api.onParseCanceled) {
        void api.onParseCanceled()
      } else {
        void api.onParseComplete()
      }
    })
    // Live-stream MatchRecords. Upsert by match_key into the same
    // records ref the static loader populates — every downstream
    // filter/group/render computed recomputes for free. The
    // parse-complete handler still calls onParseComplete() as the
    // authoritative reconciliation in case any of these events were
    // dropped on a slow SSE connection.
    EventsOn<MatchRecord>('match-updated', onMatchUpdated)
    // Background Tesseract probe result — refresh the engine status so the
    // System Alert clears itself once a cold-boot scan releases the binary.
    EventsOn<TesseractStatus>('tesseract-status', (s) => {
      if (s) api.onTesseractStatus?.(s)
    })
    // Watcher pending-file tally - the masthead's "watching · N new" dot.
    EventsOn<WatchActivityEvent>('watch-activity', (ev) => {
      if (ev && api.watchActivity) api.watchActivity.value = ev
    })
  }

  function unsubscribe() {
    EventsOff('parse-complete')
    EventsOff('parse-progress')
    EventsOff('parse-canceled')
    EventsOff('match-updated')
    EventsOff('tesseract-status')
    EventsOff('watch-activity')
  }

  onMounted(subscribe)
  onBeforeUnmount(unsubscribe)

  // Exposed for tests so subscriptions can be driven directly
  // without faking the EventsOn/Off bridge.
  return { onMatchUpdated, subscribe, unsubscribe }
}
