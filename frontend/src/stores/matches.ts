import { computed, markRaw, ref } from 'vue'
import { defineStore, storeToRefs } from 'pinia'

import type { MatchRecord } from '@/api'
import {
  GetNewScreenshotCount,
  GetMatchResults,
  GetScreenshotsDir,
  GetWatchEnabled,
  GetTesseractStatus,
  GetDataLocation,
  ParseScreenshots,
  ReParseAll,
  CancelParse,
  GetActiveParse,
} from '@/api'
import { plainLanguageError } from '@/error-helpers'
import { ONBOARDING_COMPLETED_KEY } from '@/composables/shared/storageKeys'
import type { ParseProgressEvent } from '@/components/ingest/ParseProgressPanel.vue'
import { useMatchAnchor } from '@/composables/matches/useMatchAnchor'
import { createMatchesNarrowState, useMatchesNarrow } from '@/composables/matches/useMatchesNarrow'
import { useSearchClauses } from '@/composables/matches/useSearchClauses'
import { useMatchesDossier } from '@/composables/matches/useMatchesDossier'
import { useOWData } from '@/composables/shared/useOWData'
import { useEventStream } from '@/composables/shared/useEventStream'
import { useParseRecovery } from '@/composables/ingest/useParseRecovery'
import { useIgnoredScreenshots } from '@/composables/ingest/useIgnoredScreenshots'
import { useAppStore } from '@/stores/app'
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

  // ── Onboarding tour — demo-records swap ───────────────────────────
  // Seeded from the same localStorage flag the tour reads so the welcome
  // modal stays hidden until the tour finishes (avoids a tick-0 overlay
  // stack). While active, `records` carries DEMO_MATCHES and the real fetch
  // is stashed in savedRecords (load() routes there too) for restore-on-close.
  function readTourWillOpen(): boolean {
    try { return localStorage.getItem(ONBOARDING_COMPLETED_KEY) !== 'true' }
    catch (_) { return false }
  }
  const tourActive = ref(readTourWillOpen())
  const savedRecords = ref<MatchRecord[]>([])
  async function onTourActiveChange(active: boolean) {
    if (active) {
      const { DEMO_MATCHES } = await import('@/composables/shared/useDemoMatches')
      savedRecords.value = records.value
      records.value = [...DEMO_MATCHES]
      tourActive.value = true
    } else {
      records.value = savedRecords.value
      savedRecords.value = []
      tourActive.value = false
    }
  }

  // ── Boot coordinator ──────────────────────────────────────────────
  // Promise.allSettled (NOT all): one endpoint failing MUST NOT blank the
  // others or flash a false "Tesseract not detected". Fans the results into
  // this store + the app/settings stores. Errors surface through the app
  // store's banner with `load` itself as the Retry callback.
  async function load() {
    const appStore = useAppStore()
    const settingsStore = useSettingsStore()
    const before = records.value.length
    const results = await Promise.allSettled([
      GetMatchResults(),
      GetScreenshotsDir(),
      GetWatchEnabled(),
      GetTesseractStatus(),
      GetNewScreenshotCount(),
      GetDataLocation(),
    ])
    const [recs, dir, watchOn, tess, newCount, loc] = results
    if (recs.status === 'fulfilled') {
      if (tourActive.value) {
        savedRecords.value = recs.value ?? []
      } else {
        records.value = recs.value ?? []
        if (before > 0 && records.value.length > before) flashRecordsPulse()
      }
      if (appStore.errorRetry === load) appStore.clearError()
    } else {
      appStore.setError(`Could not load matches: ${plainLanguageError(String(recs.reason))}`, load)
    }
    if (dir.status === 'fulfilled')     settingsStore.setScreenshotsDir(dir.value || '')
    if (watchOn.status === 'fulfilled') settingsStore.setWatchEnabled(!!watchOn.value)
    if (tess.status === 'fulfilled')    settingsStore.setTesseractStatus(tess.value)
    else                                settingsStore.setTesseractStatus({ path: '', found: false, version: '', supported: false, error: String(tess.reason), default: '', platform: '' })
    newScreenshotCount.value = newCount.status === 'fulfilled' ? newCount.value : null
    appStore.dataLocation = loc.status === 'fulfilled' ? loc.value : null
    firstLoadPending.value = false
  }

  // ── Parse run controls ────────────────────────────────────────────
  // Completion (load() + parseBusy=false) arrives via the parse-complete
  // event handler, NOT the POST resolving, so a mid-parse network drop can't
  // strand the panel. parseProgressOpen is IngestView's drawer; the
  // unsupported-Tesseract confirm modal gates a run on an untested engine.
  const parseProgressOpen = ref(false)
  const showUnsupportedModal = ref(false)

  async function runParse() {
    const appStore = useAppStore()
    appStore.clearError()
    parseBusy.value = true
    parseProgress.value = null
    parseLog.value = []
    parseProgressOpen.value = false
    try {
      await ParseScreenshots()
    } catch (e) {
      appStore.setErrorFromRaw(String(e))
      parseBusy.value = false
      parseProgress.value = null
      cancellingParse.value = false
    }
  }

  // Stop from IngestView's button OR the status-bar ABORT tile. Flips the
  // cancelling flag immediately; the clear happens on parse-cancelled.
  // Swallows 409 (parse finished before the Stop landed).
  async function onCancelParse() {
    if (cancellingParse.value) return
    cancellingParse.value = true
    try {
      await CancelParse()
    } catch (_) {
      cancellingParse.value = false
    }
  }

  // "Re-parse all" (Settings → Advanced) — forces re-OCR; skips the
  // unsupported-version modal (the user committed to a multi-minute run).
  async function onReParseAll() {
    const appStore = useAppStore()
    if (!useSettingsStore().tesseractReady) {
      appStore.setError("Tesseract isn't set up yet. Open Settings → Engine to configure it.")
      return
    }
    appStore.clearError()
    parseBusy.value = true
    parseProgress.value = null
    parseLog.value = []
    try {
      await ReParseAll()
    } catch (e) {
      appStore.setErrorFromRaw(String(e))
      parseBusy.value = false
      parseProgress.value = null
      cancellingParse.value = false
    }
  }

  async function parse() {
    const settingsStore = useSettingsStore()
    if (!settingsStore.tesseractReady) {
      useAppStore().setError("Tesseract isn't set up yet. Open Settings → Engine to configure it.")
      return
    }
    // Unsupported version → require explicit confirmation (OCR may be wrong).
    if (!settingsStore.tesseractSupported) {
      showUnsupportedModal.value = true
      return
    }
    await runParse()
  }

  async function confirmUnsupportedParse() {
    showUnsupportedModal.value = false
    await runParse()
  }

  // ── Ignored screenshots ───────────────────────────────────────────
  // The "Delete forever" / un-ignore triage surface; onRunParseFromIgnored
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

  // ── Ingest event stream ───────────────────────────────────────────
  // Polite sr-only announcement for parse-lifecycle terminal states (the
  // status bar goes inert at run end, leaving screen readers no signal).
  const parseAnnouncement = ref('')
  function announceParse(msg: string) {
    parseAnnouncement.value = msg
    setTimeout(() => { if (parseAnnouncement.value === msg) parseAnnouncement.value = '' }, 2000)
  }

  // Server-mode parse-stream recovery: detect a mid-parse SSE drop, resync
  // against GET /parses/active, surface a manual Refresh. No-op in Wails.
  const { connectionState: parseConnectionState, refresh: refreshParse } = useParseRecovery({
    parseBusy,
    parseProgress,
    reload: load,
    getActiveParse: GetActiveParse,
  })

  // parse-complete is the authoritative completion signal for EVERY parse
  // path (click, watcher, re-parse): the server emits it from the OCR loop,
  // so this owns clearing parseBusy + the reload.
  useEventStream({
    records,
    parseProgress,
    parseLog,
    onParseComplete: async () => {
      await load()
      lastParsedAt.value = Date.now()
      try { localStorage.setItem('recall.lastParsedAt', String(lastParsedAt.value)) } catch (_) { /* non-fatal */ }
      parseBusy.value = false
      parseProgress.value = null
      cancellingParse.value = false
      const n = records.value.length
      announceParse(`Parse complete. ${n} match${n === 1 ? '' : 'es'} loaded.`)
    },
    onParseCancelled: async () => {
      await load()
      parseBusy.value = false
      cancellingParse.value = false
      parseProgress.value = null
      announceParse('Parse cancelled.')
    },
  })

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
    tourActive,
    savedRecords,
    onTourActiveChange,
    load,
    parseProgressOpen,
    showUnsupportedModal,
    runParse,
    onCancelParse,
    onReParseAll,
    parse,
    confirmUnsupportedParse,
    parseAnnouncement,
    parseConnectionState,
    refreshParse,
    ignoredScreenshots,
    ignoredCount,
    ignoredPanelOpen,
    loadIgnored,
    openIgnoredPanel,
    closeIgnoredPanel,
    onUnignoreScreenshot,
    onClearIgnoredScreenshots,
    onRunParseFromIgnored,
  }
})
