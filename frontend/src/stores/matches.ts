import { computed, markRaw, ref } from 'vue'
import { defineStore, storeToRefs } from 'pinia'

import type { MatchRecord } from '@/api-client'
import {
  ClearDatabase,
  BackupDatabase,
  RestoreDatabase,
  ImportMatches,
} from '@/api-client'
import { getQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'
import {
  refetchMatchesCluster, useFailedFilesQuery, useMatchesQuery, usePendingCountQuery,
} from '@/queries/matches'
import { ONBOARDING_COMPLETED_KEY } from '@/composables/shared/storageKeys'
import { useMatchAnchor } from '@/composables/matches/useMatchAnchor'
import { createMatchesNarrowState, useMatchesNarrow } from '@/composables/matches/useMatchesNarrow'
import { useSearchClauses } from '@/composables/matches/useSearchClauses'
import { useMatchesDossier } from '@/composables/matches/useMatchesDossier'
import { useOWData } from '@/composables/shared/useOWData'
import { profileScopedKey } from '@/composables/shared/profileStorage'
import { useParseRunLifecycle } from '@/composables/ingest/useParseRunLifecycle'
import { useIgnoredScreenshots } from '@/composables/ingest/useIgnoredScreenshots'
import { useClearDatabase } from '@/composables/settings/useClearDatabase'
import { useBackupRestore } from '@/composables/settings/useBackupRestore'
import { useAppStore } from '@/stores/app'
import { useCoachStore } from '@/stores/coach'
import { useExportBundle } from '@/composables/matches/useExportBundle'
import { useSettingsStore } from '@/stores/settings'

// The matches domain: the parsed-match records (source of truth for the
// dossier + all four views) and the derived triage lists. Migrated out of
// App.vue's <script setup>. useAppBoot fans each store's own
// loaders out at mount (this store's load() covers records + new-count);
// parse lifecycle, narrow, and the dossier also live here.
export const useMatchesStore = defineStore('matches', () => {
  // The records live in the query cache; this store hosts the one
  // app-lifetime observer. `records` is a WRITABLE computed: reads are
  // tour-aware (demo data overlays the cache while the tour runs), and the
  // few remaining writers (the match-updated upsert, test seeding) route
  // through setQueryData so the cache stays the single source of truth.
  const matchesQuery = useMatchesQuery()
  const realRecords = computed(() => matchesQuery.data.value ?? [])
  const coach = useCoachStore()

  // Overlay precedence is SESSION > TOUR > real, and the two overlays are
  // MUTUALLY EXCLUSIVE: a session cannot open while the tour runs (the
  // switcher's "Open a player's bundle…" item is disabled), and the tour
  // can neither auto-open nor be replayed while a session is live
  // (onTourActiveChange below refuses). So the order below is the
  // documented precedence, not an arbitration of a race that can happen.
  function visibleRecords(): MatchRecord[] {
    if (coach.sessionActive) return coach.loanedRecords
    if (tourActive.value) return demoRecords.value
    return realRecords.value
  }

  const records = computed({
    get: visibleRecords,
    set: (next: MatchRecord[]) => {
      // Cancel any in-flight fetch first: a direct write is newer than
      // whatever that response would carry (the match-updated upsert in
      // production, cache seeding in tests), and the authoritative
      // parse-complete refetch follows anyway.
      void getQueryClient().cancelQueries({ queryKey: qk.matches })
      getQueryClient().setQueryData(qk.matches, next)
    },
  })

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
  // Drives the Matches skeleton from boot until the first fetch settles —
  // isPending never flips back to true across invalidation refetches.
  const firstLoadPending = computed(() => matchesQuery.isPending.value)
  // Cluster siblings of the records query — silent keep-last on failure.
  // newScreenshotCount: image files in the dir not yet in the DB (null =
  // not yet fetched).
  const pendingCountQuery = usePendingCountQuery()
  const newScreenshotCount = computed(() => pendingCountQuery.data.value ?? null)
  const failedFilesQuery = useFailedFilesQuery()
  const failedFiles = computed(() => failedFilesQuery.data.value ?? [])

  async function refreshNewCount() {
    await getQueryClient().refetchQueries({ queryKey: qk.pendingCount })
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

  // ── Onboarding tour — demo-records overlay ────────────────────────
  // Seeded from the same localStorage flag the tour reads so the welcome
  // modal stays hidden until the tour finishes (avoids a tick-0 overlay
  // stack). While active, `records` reads DEMO_MATCHES; the real data keeps
  // flowing into the query cache underneath, so closing the tour is a pure
  // flag flip — no stash/restore.
  function readTourWillOpen(): boolean {
    try { return localStorage.getItem(ONBOARDING_COMPLETED_KEY) !== 'true' }
    catch (_) { return false }
  }
  const tourActive = ref(readTourWillOpen())
  const demoRecords = ref<MatchRecord[]>([])
  // The coach store can't import this one (the corpus flows the other
  // way), so the tour flag is PUSHED to it — that is how "opening a
  // session while the tour runs is refused" is enforced from over there.
  coach.setTourOpen(tourActive.value)

  async function onTourActiveChange(active: boolean) {
    // The other half of the exclusivity above: neither the first-launch
    // auto-open nor Settings' Replay may put demo data over a player's
    // loaned corpus mid-session.
    if (active && coach.sessionActive) return
    coach.setTourOpen(active)
    if (active) {
      const { DEMO_MATCHES } = await import('@/composables/shared/useDemoMatches')
      demoRecords.value = [...DEMO_MATCHES]
      tourActive.value = true
    } else {
      demoRecords.value = []
      tourActive.value = false
    }
  }

  // ── Reload seam ───────────────────────────────────────────────────
  // load() keeps its name as the awaitable cluster refetch — the callers
  // (parse-complete, clear-DB, manual-match create) rely on "reload
  // finished" ordering. Error/banner handling moved to the query layer:
  // the matches query carries the banner meta, the siblings are silent
  // keep-last, and per-subsystem isolation falls out of one query per
  // endpoint. The pulse fires here (once per completed reload that grew
  // the set — the watcher-parse "new matches arrived" signal), never on
  // the per-file match-updated upserts.
  async function load() {
    const before = (getQueryClient().getQueryData<MatchRecord[]>(qk.matches) ?? []).length
    await refetchMatchesCluster()
    const after = (getQueryClient().getQueryData<MatchRecord[]>(qk.matches) ?? []).length
    if (before > 0 && after > before) flashRecordsPulse()
  }

  // ── Parse-run lifecycle (composed module) ─────────────────────────
  // Run/stop controls, progress + announcement state, the terminal
  // transitions, and the stream-recovery bridge — the whole cluster
  // lives in useParseRunLifecycle; the store spreads it into its public
  // surface under the same names.
  const parseRun = useParseRunLifecycle({ load })
  // The two members the rest of this setup wires directly: `parse`
  // feeds the ignored-screenshots panel, `lastParsedAt` the clear-DB
  // reset below.
  const { parse, lastParsedAt } = parseRun

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

  // Narrow-chip toggle contract for the detail card's inline filter chips:
  // isNarrowChipActive reports whether a hero/role/result/map/type/tag chip is
  // picked; toggleNarrowChip flips it. Unknown fields read inactive + no-op.
  const narrowChipFields: Record<string, { picked: () => Set<string>; pick: (v: string) => void }> = {
    hero:   { picked: () => matchesNarrowState.pickedHeroes.value,    pick: matchesNarrow.pickHero },
    role:   { picked: () => matchesNarrowState.pickedRoles.value,     pick: matchesNarrow.pickRole },
    result: { picked: () => matchesNarrowState.pickedResults.value,   pick: matchesNarrow.pickResult },
    map:    { picked: () => matchesNarrowState.pickedMaps.value,      pick: matchesNarrow.pickMap },
    type:   { picked: () => matchesNarrowState.pickedGameModes.value, pick: matchesNarrow.pickGameMode },
    tag:    { picked: () => matchesNarrowState.pickedTags.value,      pick: matchesNarrow.pickTag },
  }
  function isNarrowChipActive(field: string, value: string): boolean {
    return narrowChipFields[field]?.picked().has(value) ?? false
  }
  function toggleNarrowChip(field: string, value: string) {
    narrowChipFields[field]?.pick(value)
  }

  // ── Dossier (KPIs + breakdowns over the narrowed set) ─────────────
  // One aggregation over narrowedRecords, exposed to dashboard widgets via
  // provideDossier(matchesStore.dossier) in MatchesView. weekStart comes from
  // the settings store (lifecycle-safe there). ONE useOWData() call feeds
  // all four dossiers — each call registers its own reference-data query
  // observer, so repeating it would create four for no benefit. The
  // settings-store import is a cycle (settings → matches for
  // refreshNewCount) but resolves fine: both cross-calls run inside store
  // setups/callbacks, after the modules load. storeToRefs keeps weekStart
  // a Ref (the dossier wants Readonly<Ref>); reading
  // settingsStore.weekStart directly would unwrap it to a value.
  const { weekStart } = storeToRefs(useSettingsStore())
  const { heroRole } = useOWData()
  const dossier = useMatchesDossier(
    matchesNarrow.narrowedRecords,
    matchesNarrow.leaverHandling,
    heroRole,
    weekStart,
  )
  // A second aggregation over the UNFILTERED records (ignores the narrow), so
  // widgets/bands can size their structure stably — provided alongside the
  // narrowed one via provideFullDossier() in MatchesView. Same lazy computeds,
  // so only the structure queries a consumer touches actually recompute.
  const fullDossier = useMatchesDossier(
    records,
    matchesNarrow.leaverHandling,
    heroRole,
    weekStart,
  )
  // Per-band "narrow minus self" aggregations: each reads everything EXCEPT its
  // own filter dimension, so a band reflects the OTHER bands' picks (they
  // indirectly affect each other) but doesn't collapse from its own selection.
  // Geography drops its maps/roles; Hero×Game-Mode drops its heroes/game-modes.
  const geographyDossier = useMatchesDossier(
    matchesNarrow.narrowedExceptMapsRoles,
    matchesNarrow.leaverHandling,
    heroRole,
    weekStart,
  )
  const heroModeDossier = useMatchesDossier(
    matchesNarrow.narrowedExceptHeroesGameModes,
    matchesNarrow.leaverHandling,
    heroRole,
    weekStart,
  )

  // ── Clear-DB + backup/restore (data ops, surfaced in Settings) ────
  // After a wipe/import, reload records + the ignored list. pendingClearOpts
  // carries SettingsAdvanced's "Keep suppress-list" choice into the api seam.
  const pendingClearOpts = ref<{ keepIgnored: boolean }>({ keepIgnored: false })
  const { clearingDB, clearConfirm, clearDatabase, armClear, cancelClear } = useClearDatabase({
    clearDatabase: () => ClearDatabase(pendingClearOpts.value.keepIgnored),
    afterClear: async () => {
      await load()
      await loadIgnored()
    },
    resetLastParsedAt: () => {
      lastParsedAt.value = null
      try { localStorage.removeItem(profileScopedKey('lastParsedAt')) } catch (_) { /* non-fatal */ }
    },
    onError: (m) => useAppStore().setErrorFromRaw(m),
  })
  function onClearDatabase(opts: { keepIgnored: boolean }) {
    pendingClearOpts.value = opts
    return clearDatabase()
  }

  const {
    backingUp,
    restoring,
    restoreArmed,
    importingMatches,
    status: backupStatus,
    backup,
    armRestore,
    cancelRestore,
    restore,
    importMatches,
  } = useBackupRestore({
    backup: BackupDatabase,
    restore: RestoreDatabase,
    importMatches: ImportMatches,
    // A coach's notes archive comes back through the same Import…
    // affordance and merges nothing — it stages a return sheet the player
    // decides on, so the sheet opens and no reload follows.
    onCoachNotes: (sheet) => { coach.stageImportedNotes(sheet) },
    // Restore replaces the whole database and an import can carry
    // suppress-list entries — refresh the ignored list along with the
    // cluster so the Settings panel doesn't show a stale one.
    reload: async () => {
      await load()
      await loadIgnored()
    },
  })

  // Export flows for the Matches set — the bundle-export modal + the flat CSV
  // export. Delegated to useExportBundle; AppOverlays reads the modal state +
  // the dispatch handlers straight off this store.
  const exportBundle = useExportBundle({ onError: (m) => useAppStore().setErrorFromRaw(m) })

  return {
    // markRaw the composable bundles: Pinia's reactive() store deep-unwraps
    // nested refs, which would turn matchesNarrow.narrowedRecords (a Ref) into
    // a bare value and break every `.value` consumer. markRaw keeps the bundle
    // raw so its inner refs stay refs (and stay reactive on their own).
    matchAnchor: markRaw(matchAnchor),
    matchesNarrowState: markRaw(matchesNarrowState),
    matchesNarrow: markRaw(matchesNarrow),
    isNarrowChipActive,
    toggleNarrowChip,
    dossier: markRaw(dossier),
    fullDossier: markRaw(fullDossier),
    geographyDossier: markRaw(geographyDossier),
    heroModeDossier: markRaw(heroModeDossier),
    searchClauses,
    records,
    unknownRecords,
    referenceGapRecords,
    hiddenRecords,
    ambiguousRecords,
    firstLoadPending,
    newScreenshotCount,
    refreshNewCount,
    recordsPulse,
    tourActive,
    onTourActiveChange,
    load,
    // The whole parse-run lifecycle cluster (parseBusy, runParse,
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
    failedFiles,
    clearingDB,
    clearConfirm,
    armClear,
    cancelClear,
    onClearDatabase,
    backingUp,
    restoring,
    restoreArmed,
    importingMatches,
    backupStatus,
    backup,
    armRestore,
    cancelRestore,
    restore,
    importMatches,
    // Export-bundle modal + dispatch (delegated to useExportBundle)
    exportBundleOpen: exportBundle.exportBundleOpen,
    exportBundleSelectedKeys: exportBundle.exportBundleSelectedKeys,
    onExportBundleRequest: exportBundle.onExportBundleRequest,
    closeExportBundle: exportBundle.closeExportBundle,
    onExportMatchesCSV: exportBundle.onExportMatchesCSV,
    onExportBundleConfirm: exportBundle.onExportBundleConfirm,
  }
})
