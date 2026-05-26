import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { EventsOn, EventsOff, type MatchRecord } from '../api'
import type { ParseProgressEvent } from '../components/ParseProgressPanel.vue'

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
    EventsOff('match-updated')
  }

  onMounted(subscribe)
  onBeforeUnmount(unsubscribe)

  // Exposed for tests so subscriptions can be driven directly
  // without faking the EventsOn/Off bridge.
  return { onMatchUpdated, subscribe, unsubscribe }
}
