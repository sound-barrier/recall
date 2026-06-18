import { computed, markRaw, ref } from 'vue'
import { defineStore, storeToRefs } from 'pinia'

import type { MatchRecord } from '@/api'
import { GetNewScreenshotCount } from '@/api'
import type { ParseProgressEvent } from '@/components/ingest/ParseProgressPanel.vue'
import { useMatchAnchor } from '@/composables/matches/useMatchAnchor'
import { createMatchesNarrowState, useMatchesNarrow } from '@/composables/matches/useMatchesNarrow'
import { useSearchClauses } from '@/composables/matches/useSearchClauses'
import { useMatchesDossier } from '@/composables/matches/useMatchesDossier'
import { useOWData } from '@/composables/shared/useOWData'
import { useSettingsStore } from '@/stores/settings'

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

  // ── Narrow filter + anchor cluster ────────────────────────────────
  // The Matches-view filter state lives here so `selection` (the detail
  // panel) + the dossier paginate/aggregate against the same narrowedRecords
  // the view shows. The "since this match" anchor persists per-OS-profile;
  // narrowState borrows its ref so the filter sees detail-panel mutations
  // without a round-trip. Exposed as composable bundles (their inner refs
  // don't auto-unwrap at object depth — consumers destructure them into
  // top-level vars, the same CardStateApi convention used elsewhere).
  const matchAnchor = useMatchAnchor()
  const matchesNarrowState = createMatchesNarrowState({ anchorKey: matchAnchor.anchorKey })
  const matchesNarrow = useMatchesNarrow(records, matchesNarrowState)
  const { searchClauses } = useSearchClauses(matchesNarrowState.searchText)

  // ── Dossier (KPIs + breakdowns over the narrowed set) ─────────────
  // One aggregation over narrowedRecords, exposed to dashboard widgets via
  // provideDossier(matchesStore.dossier) in MatchesView. weekStart comes from
  // the settings store (lifecycle-safe there); useOWData is a session
  // singleton with no lifecycle hooks. The settings-store import is a cycle
  // (settings → matches for refreshNewCount) but resolves fine: both
  // cross-calls run inside store setups/callbacks, after the modules load.
  // storeToRefs keeps weekStart a Ref (the dossier wants Readonly<Ref>);
  // reading settingsStore.weekStart directly would unwrap it to a value.
  const { weekStart } = storeToRefs(useSettingsStore())
  const dossier = useMatchesDossier(
    matchesNarrow.narrowedRecords,
    matchesNarrow.leaverHandling,
    useOWData().heroRole,
    weekStart,
  )

  return {
    // markRaw the composable bundles: Pinia's reactive() store deep-unwraps
    // nested refs, which would turn matchesNarrow.narrowedRecords (a Ref) into
    // a bare value and break every `.value` consumer. markRaw keeps the bundle
    // raw so its inner refs stay refs (and stay reactive on their own).
    matchAnchor: markRaw(matchAnchor),
    matchesNarrowState: markRaw(matchesNarrowState),
    matchesNarrow: markRaw(matchesNarrow),
    dossier: markRaw(dossier),
    searchClauses,
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
