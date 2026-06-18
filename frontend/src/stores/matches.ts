import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import type { MatchRecord } from '@/api'
import { GetNewScreenshotCount } from '@/api'
import type { ParseProgressEvent } from '@/components/ingest/ParseProgressPanel.vue'

// The matches domain: the parsed-match records (source of truth for the
// dossier + all four views) and the derived triage lists. Migrated out of
// App.vue's <script setup>. App's boot coordinator (load()) still owns the
// allSettled fan-out and writes `records` here; parse lifecycle, narrow, and
// the dossier move into this store in later commits of the Pinia migration.
export const useMatchesStore = defineStore('matches', () => {
  const records = ref<MatchRecord[]>([])

  // Records that couldn't be resolved to a named match — either the
  // screenshot filename had no parseable OW timestamp ("unmatched-…") or OCR
  // failed to determine a map name. Surface in the Unknown Maps view.
  const unknownRecords = computed(() =>
    records.value.filter(r => !r.data?.map && !r.ambiguous),
  )
  // Records where the parser captured an OCR'd hero/map name but couldn't pin
  // it to the canonical YAML rosters — awaiting a YAML release. Drives the
  // Unknown tab's reference-gap column.
  const referenceGapRecords = computed(() =>
    records.value.filter(r => (!r.data?.hero && !!r.data?.hero_raw)
      || (!r.data?.map && !!r.data?.map_raw)),
  )
  // Records the user flagged hidden via the Matches drawer. The export-bundle
  // modal surfaces the count + the "include hidden" toggle.
  const hiddenRecords = computed(() =>
    records.value.filter(r => !!r.hidden),
  )
  // Records the resolver couldn't pin to a single match (EAD-bridge
  // ambiguity). Surface above unknownRecords in the Unknown tab for the
  // candidate picker.
  const ambiguousRecords = computed(() =>
    records.value.filter(r => r.ambiguous),
  )

  // ── Parse lifecycle state ─────────────────────────────────────────
  // parseBusy gates the manual Parse button + peers; cancellingParse spans
  // the Stop click → SSE parse-cancelled confirmation; firstLoadPending
  // drives the Matches skeleton from boot until the first load() resolves.
  const parseBusy = ref(false)
  const cancellingParse = ref(false)
  const firstLoadPending = ref(true)
  // parseProgress: most-recent completed file during an active parse (null
  // when idle). parseLog: rolling completed-file log. newScreenshotCount:
  // image files in the dir not yet in the DB (null = not yet fetched).
  const parseProgress = ref<ParseProgressEvent | null>(null)
  const parseLog = ref<ParseProgressEvent[]>([])
  const newScreenshotCount = ref<number | null>(null)
  // Wall-clock of the last successful manual parse → Settings "Last run · X".
  const lastParsedAt = ref<number | null>(null)

  async function refreshNewCount() {
    try { newScreenshotCount.value = await GetNewScreenshotCount() } catch (_) { /* keep last */ }
  }

  // Brief scoreboard pulse when the watcher / a manual parse brings in
  // additional records — otherwise the auto-refresh is silent.
  const recordsPulse = ref(false)
  let recordsPulseTimer: ReturnType<typeof setTimeout> | null = null
  function flashRecordsPulse() {
    recordsPulse.value = true
    if (recordsPulseTimer) clearTimeout(recordsPulseTimer)
    recordsPulseTimer = setTimeout(() => { recordsPulse.value = false }, 1600)
  }

  return {
    records,
    unknownRecords,
    referenceGapRecords,
    hiddenRecords,
    ambiguousRecords,
    parseBusy,
    cancellingParse,
    firstLoadPending,
    parseProgress,
    parseLog,
    newScreenshotCount,
    lastParsedAt,
    refreshNewCount,
    recordsPulse,
    flashRecordsPulse,
  }
})
