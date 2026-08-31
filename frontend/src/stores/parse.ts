import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { useIgnoredScreenshots } from '@/composables/ingest/useIgnoredScreenshots'
import { useParseRunLifecycle } from '@/composables/ingest/useParseRunLifecycle'
import { useParseStalenessQuery } from '@/queries/system'
import { refetchPendingCount, useFailedFilesQuery, usePendingCountQuery } from '@/queries/matches'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'

// The ingest side of the app: everything between a screenshot landing in the
// watched folder and a record existing. The run itself (start, stop, progress,
// the terminal transitions the server events drive, the stream-recovery
// bridge), the two ledgers that describe the folder rather than the database
// (files not parsed yet, files that failed to read), the suppress-list the user
// builds out of the Unknown tab, and the scoreboard pulse that says a run
// brought something home.
//
// The matches store owns the RECORDS; this one owns the pipeline that produces
// them. The two touch in exactly two places, both inside callbacks so neither
// store reaches into the other while it is still being built: a finished run
// calls the matches store's load(), and that load() flashes the pulse here when
// the set grew.
export const useParseStore = defineStore('parse', () => {
  // ── Parse-run lifecycle (composed module) ─────────────────────────
  // Run/stop controls, progress + announcement state, the terminal
  // transitions, and the stream-recovery bridge — the whole cluster
  // lives in useParseRunLifecycle; the store spreads it into its public
  // surface under the same names.
  const parseRun = useParseRunLifecycle({ load: () => useMatchesStore().load() })

  watch(() => useMatchesStore().recordsArrivals, () => { flashRecordsPulse() })

  // Entering Parse re-reads the pending-screenshot count so "Run Parse · N"
  // reflects the folder now, not the initial-load batch. Fire-and-forget.
  //
  // The app store used to push this by calling into here on every tab change,
  // which made the shell import the pipeline it knows nothing about — a
  // backwards edge, and one end of a 21-cycle knot in the module graph. Parse
  // already depends on the shell, so it watches instead of being told.
  // Routed through the store rather than the local closure so the internal
  // trigger and any external caller go through the same door.
  watch(() => useAppStore().view, (next) => {
    if (next === 'ingest') void useParseStore().refreshNewCount()
  })
  // The one member the rest of this setup wires directly: `parse` feeds
  // the ignored-screenshots panel's "Run Parse now".
  const { parse } = parseRun

  // ── Ignored screenshots ───────────────────────────────────────────
  // The Dismiss / un-ignore triage surface; onRunParseFromIgnored
  // re-runs the parse (this store's own `parse`) so re-included files land.
  const {
    ignoredScreenshots,
    ignoredCount,
    ignoredPanelOpen,
    loadIgnored,
    openIgnoredPanel,
    closeIgnoredPanel,
    onUnignoreScreenshot,
    onClearIgnoredScreenshots,
    onRunParseFromIgnored,
  } = useIgnoredScreenshots({
    onError: (m) => useAppStore().setErrorFromRaw(m),
    goToView: (v) => useAppStore().goToView(v),
    parse,
  })

  // ── The two folder-side ledgers ───────────────────────────────────
  // Cluster siblings of the records query — silent keep-last on failure.
  // newScreenshotCount: image files in the dir not yet in the DB (null =
  // not yet fetched). parkedCount: on-disk files parse gave up on after
  // repeated failures (out of the button's count, retryable from the
  // Unknown tab). failedFiles: the ones OCR could not read at all, which
  // have no record to ride on.
  const pendingCountQuery = usePendingCountQuery()
  const newScreenshotCount = computed(() => pendingCountQuery.data.value?.count ?? null)
  const parkedCount = computed(() => pendingCountQuery.data.value?.parked ?? 0)
  const failedFilesQuery = useFailedFilesQuery()
  const failedFiles = computed(() => failedFilesQuery.data.value ?? [])

  // ── Parse vintage ─────────────────────────────────────────────────
  // How many matches an older parser read, and the generation judging it.
  // Defaulting BOTH to 0 is load-bearing: before the first response, and on a
  // failed read, the notice renders nothing rather than flashing a count it
  // does not have.
  const stalenessQuery = useParseStalenessQuery()
  const staleMatches = computed(() => stalenessQuery.data.value?.stale_matches ?? 0)
  const parserGeneration = computed(() => stalenessQuery.data.value?.parser_generation ?? 0)

  async function refreshNewCount() {
    await refetchPendingCount()
  }

  // ── Scoreboard pulse ──────────────────────────────────────────────
  // Brief masthead pulse when the watcher / a manual parse brings in
  // additional records — otherwise the auto-refresh is silent. The matches
  // store counts arrivals (it is the only place that can tell a reload which
  // grew the set from one that didn't); deciding that an arrival looks like a
  // pulse is this store's business, so it watches rather than being called.
  const recordsPulse = ref(false)
  let recordsPulseTimer: ReturnType<typeof setTimeout> | null = null
  function flashRecordsPulse() {
    recordsPulse.value = true
    if (recordsPulseTimer) clearTimeout(recordsPulseTimer)
    recordsPulseTimer = setTimeout(() => { recordsPulse.value = false }, 1600)
  }

  return {
    // The whole parse-run lifecycle cluster (parseBusy, parse,
    // finishParseRun, the recovery bridge, …) under its original names.
    ...parseRun,
    ignoredScreenshots,
    ignoredCount,
    ignoredPanelOpen,
    loadIgnored,
    openIgnoredPanel,
    closeIgnoredPanel,
    onUnignoreScreenshot,
    onClearIgnoredScreenshots,
    onRunParseFromIgnored,
    newScreenshotCount,
    parkedCount,
    refreshNewCount,
    failedFiles,
    staleMatches,
    parserGeneration,
    recordsPulse,
    flashRecordsPulse,
  }
})
