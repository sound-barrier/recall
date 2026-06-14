import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { EventsOn, EventsOff, type MatchRecord } from '@/api'
import type { ParseProgressEvent } from '@/components/ingest/ParseProgressPanel.vue'

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
  // Called when a parse batch finishes. Should reload records and
  // refresh whatever the caller wants invalidated.
  onParseComplete: () => Promise<void> | void
  // Called when a parse run was aborted via CancelParse. Distinct
  // hook so the consumer can flip a "cancelling…" state back to
  // idle, render different toast copy, etc. Optional — if absent,
  // parse-cancelled is treated the same as parse-complete (still
  // safe; the records ref reflects the partial state).
  onParseCancelled?: () => Promise<void> | void
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
    // parse-cancelled is the third terminal lifecycle event (the
    // other two are parse-complete and the implicit
    // "no-more-progress-ticks"). The records ref already reflects
    // any partial state because the per-file inserts ran inside the
    // OCR callback; the consumer just needs to know to flip the
    // Stop button + "cancelling…" indicator back to idle.
    EventsOn('parse-cancelled', () => {
      if (api.onParseCancelled) {
        void api.onParseCancelled()
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
  }

  function unsubscribe() {
    EventsOff('parse-complete')
    EventsOff('parse-progress')
    EventsOff('parse-cancelled')
    EventsOff('match-updated')
  }

  onMounted(subscribe)
  onBeforeUnmount(unsubscribe)

  // Exposed for tests so subscriptions can be driven directly
  // without faking the EventsOn/Off bridge.
  return { onMatchUpdated, subscribe, unsubscribe }
}
