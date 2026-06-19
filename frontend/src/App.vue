<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
// App-wide styles — extracted from this SFC to keep App.vue navigable
// (~890 lines of template + script vs. ~4 600 lines when the 3 698-line
// <style> block was inline). Imported here rather than via main.ts so
// the dependency lives next to the component that anchors the cascade.
// Still globally scoped (matches the historical behaviour); component-
// specific selectors are tracked for a follow-up extraction into
// per-SFC scoped <style> blocks.
import '@/styles/app.css'

import { ref, computed, watch, onMounted, nextTick, defineAsyncComponent, type Component } from 'vue'
import { storeToRefs } from 'pinia'
import type { MatchRecord } from '@/api'
import {
  GetStartupError,
} from '@/api'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { tallyWLD } from '@/match/match-stats-helpers'
import { useTabKeyboardNav, TAB_ORDER } from '@/composables/shared/useTabKeyboardNav'
import { useGlobalKeyboard } from '@/composables/shared/useGlobalKeyboard'
import { useModalFocusTrap } from '@/composables/shared/useModalFocusTrap'
import { useExportBundle } from '@/composables/matches/useExportBundle'
import { useAnchorToast } from '@/composables/app/useAnchorToast'
import { useOnboardingTourBridge } from '@/composables/app/useOnboardingTourBridge'
import ParseStatusBar from '@/components/ingest/ParseStatusBar.vue'
import AppMasthead from '@/components/app/AppMasthead.vue'
import AppOverlays, { type OverlaysApi } from '@/components/app/AppOverlays.vue'
import SystemAlertBanner from '@/components/app/SystemAlertBanner.vue'
import ErrorBanner from '@/components/app/ErrorBanner.vue'
import MatchesSkeleton from '@/components/matches/shared/MatchesSkeleton.vue'
import UpdateReminderBanner from '@/components/shared/UpdateReminderBanner.vue'
import { useUpdateReminder } from '@/composables/shared/useUpdateReminder'
import { useFirstRunAcknowledged } from '@/composables/shared/useFirstRunAcknowledged'

// The floating overlay cluster (modals, detail panel, lightbox, toasts, tour)
// lives in AppOverlays — it owns those lazy-loaded chunks now.

// View components are lazy-loaded via defineAsyncComponent so each
// becomes a separate JS chunk emitted by Vite. The initial bundle
// only ships the currently-visible view (Matches by default); the
// other three load on first tab click. Keeps initial JS small and
// makes the cost of adding a new view proportional to "is it
// visited" rather than "is it imported".
//
// `loadingComponent` + `delay: 220` shows a brief "Loading view…"
// fallback IF the chunk fetch + Vue mount takes longer than 220ms
// (the common case on throttled networks). On LAN / local the
// chunk lands before the delay elapses and the fallback never
// renders, keeping the snappy-feel intact.
import ViewLazyFallback from '@/components/shared/ViewLazyFallback.vue'
const VIEW_LAZY_DELAY = 220
function lazyView(loader: () => Promise<{ default: Component }>) {
  return defineAsyncComponent({
    loader,
    loadingComponent: ViewLazyFallback,
    delay: VIEW_LAZY_DELAY,
  })
}
const IngestView = lazyView(() => import('@/components/ingest/IngestView.vue'))
const MatchesView = lazyView(() => import('@/components/matches/MatchesView.vue'))
const SettingsView = lazyView(() => import('@/components/settings/SettingsView.vue'))
const UnknownMapsView = lazyView(() => import('@/components/unknown/UnknownMapsView.vue'))

// App-shell cross-cutting state (error banner, version, update check, data
// location) lives in the Pinia app store. Destructure with the same local
// names so the existing call sites in this file stay unchanged.
const appStore = useAppStore()
const {
  error,
  errorRetry,
  appVersion,
  updateInfo,
  updateCheckBusy,
} = storeToRefs(appStore)
const { setErrorFromRaw, clearError, checkForUpdates, goToView } = appStore
const { view } = storeToRefs(appStore)

// Matches domain: records (source of truth) + the derived triage lists live
// in the matches store. App's load() boot coordinator writes `records`;
// destructure with the same local names so this file's call sites are
// unchanged.
const matchesStore = useMatchesStore()
const {
  records,
  unknownRecords,
  cancellingParse,
  firstLoadPending,
  parseProgress,
  parseLog,
  lastParsedAt,
  recordsPulse,
  tourActive,
  showUnsupportedModal,
  parseAnnouncement,
} = storeToRefs(matchesStore)
const {
  load,
  onTourActiveChange,
  onCancelParse,
  loadIgnored,
} = matchesStore

// Onboarding tour demo-records swap (tourActive / savedRecords /
// onTourActiveChange) + the boot coordinator load() live in the matches store.

// Onboarding-tour bridge: the @navigate/@open-narrow/@apply-hero-filter etc.
// handlers that drive the live surfaces per tour step (DOM + view nav).
const {
  onTourSeedAndSwitch,
  onTourOpenNarrow,
  onTourCloseNarrow,
  onTourApplyHeroFilter,
  onTourClearFilters,
} = useOnboardingTourBridge()

// view + goToView live in the app store; useTabKeyboardNav drives them.
const { onTabKeydown, focusMain } = useTabKeyboardNav(view, goToView)

// ── Keyboard-shortcut + card-focus state ──────────────────────
// Card focus (the j/k/gg/G/n/N + e/t targets) lives in useCardFocus,
// which owns focusedCardIndex + the rendered-DOM-order walk helpers
// App.vue threads into useGlobalKeyboard. `openCheatsheet` toggles the
// `?` cheatsheet modal.
// Detail-panel selection, screenshot preview/lightbox, and card focus live
// in the UI store (markRaw bundles — destructure into top-level vars).
const uiStore = useUiStore()
const {
  focusedCardIndex,
  focusCardByRenderedDelta,
  focusCardByRenderedEnd,
  focusSectionByRenderedDelta,
} = uiStore.cardFocus
const openCheatsheet = ref(false)


// Tesseract status (path / found / version / supported flag) + the
// "Browse for binary…" + "Reset to default" pickers + the System Alert
// CTA that deep-links into Settings → Engine.
const settingsStore = useSettingsStore()
const {
  tesseractStatus,
  tesseractReady,
  screenshotsDir,
  probing,
  screenshotCandidates,
} = storeToRefs(settingsStore)
const {
  gotoEngineSettings,
  pickDir,
  loadScreenshotCandidates,
  pickDetectedSource,
} = settingsStore

const showManualMatchModal = ref(false)

// Modal focus trap — captures the trigger, focuses the first
// focusable inside `.modal-box` (markup-first = Cancel button, never
// the destructive Continue Anyway), traps Tab/Shift+Tab, treats
// Escape as cancel, restores focus to the trigger on close.
useModalFocusTrap(showUnsupportedModal, { containerSelector: '.modal-box' })

// Startup-failure modal. `startupErrorMessage` is filled by the
// onMounted GetStartupError() call below; the modal is open
// iff the message is non-empty. Unlike showUnsupportedModal it has
// no Cancel — the only recovery is restart, because Startup
// failures mean SQLite or profile init didn't happen and the rest
// of the app can't function. Driven by a computed so the focus
// trap composable can watch a Ref<boolean>.
const startupErrorMessage = ref('')
const showStartupErrorModal = computed(() => startupErrorMessage.value !== '')
// Non-dismissible: Escape becomes a no-op so the user can't
// trap-fail into a half-broken app. Restart is the only recovery.
useModalFocusTrap(showStartupErrorModal, {
  containerSelector: '.modal-box.startup-error',
  onClose: () => {},
})

// First-run picker candidates + pickDetectedSource live in the settings store
// (shared with SettingsView's source picker).

// Filter / filter-panel / grouping composables — owned here so the

// (Per-card expand state replaced by the `selection` composable
// introduced for the detail-panel pattern. See below.)



// 90-day "haven't checked for updates in a while" reminder banner.
// Gated on updateInfo.last_checked_at (server-side persisted) +
// recall.updateReminder.dismissedAt (per-cycle dismissal). Hidden
// while updateInfo is null so we don't flash false-positive content
// on first paint.
const {
  shouldShowBanner: showUpdateReminder,
  daysSinceLastCheck: updateReminderDays,
  dismiss: dismissUpdateReminder,
} = useUpdateReminder(updateInfo)


// Parse run controls (runParse / parse / onReParseAll / onCancelParse /
// confirmUnsupportedParse) + parseProgressOpen + showUnsupportedModal live in
// the matches store.

// Clear-DB + backup/restore (data ops) live in the matches store.

// Open the native folder picker via Wails. The Go side persists the
// choice so subsequent app launches pick up the same directory; we
// just need to refresh our local mirror.
//
// Guard: if Watch is currently armed, confirm before re-targeting the
// watcher to a new folder. The watcher otherwise silently switches and
// (if the new folder is empty or invalid) keeps running against nothing
// with no feedback to the user.

// User-curated per-match leaver annotation. Routes through the
// unified SetMatchAnnotation writer with every other field carried
// over from the existing record so a leaver-chip click only changes
// the leaver bit — note / replay_code / members / tags survive.
// A manual match was created → close the modal, reload so it appears in the
// list, and open it so the user can add the right-panel review / replay-code
// details (the choosers key on match_key and work unchanged).
async function onManualMatchCreated(rec: MatchRecord) {
  showManualMatchModal.value = false
  await load()
  selection.open(rec.match_key)
}

// "Since this match" anchor handler. Empty string clears; any
// other value sets the anchor to that match. Frontend-only (no
// API round-trip) since the anchor is persisted in localStorage.
// Also fires the confirmation toast — set with the match's
// date-and-map label so the user can verify they got the right
// match, cleared with a simpler "filter cleared" note.
// Bulk-hide handler — MatchesView emits this when the user clicks
// Hide on the bulk action bar after ticking N rows. Fans out
// SetMatchVisibility(true) in parallel so the request stream
// pipelines instead of serializing, then reloads once when every
// PUT settles. A single failure aborts and surfaces the error;
// partial state is fine because each /visibility PUT is idempotent
// and the user can retry.
// Match-mutation handlers (context-menu + drawer bulk + per-match status +
// annotation/data edits + ambiguous-resolve + ignore) all live in
// useMatchActions, wired below.

// ── Export-bundle + CSV flow ─────────────────────────────────────────
// The Matches bulk-action bar emits `export-bundle` / `export-csv` with the
// ticked keys (or a ready-to-save CSV string); useExportBundle owns the modal
// state + the ExportBundle / ExportMatchesCSV dispatch.
const {
  exportBundleOpen,
  exportBundleSelectedKeys,
  onExportBundleRequest,
  onExportMatchesCSV,
  onExportBundleConfirm,
} = useExportBundle({ onError: setErrorFromRaw })

// Ignored-screenshot management (Settings → Advanced → Manage panel) lives in
// useIgnoredScreenshots — the suppress-list + count chip + restore/clear/
// re-parse actions. loadIgnored is called from the record-reload, clear-DB, and
// ignore flows; the panel's actions need App.vue's error surface + view nav +
// the manual-parse kick.
// Ignored screenshots (triage surface) live in the matches store.


// Selected-match panel (replaces the old inline-expansion model).
// Clicking a card opens the right-side MatchDetailPanel and pins
// `selection.selectedKey` to that match_key. ← / → inside the panel
// paginates through the filtered list. The composable auto-closes
// when the selected match leaves the filtered set (filter change,
// hide-toggle, re-parse drop).
// MatchesView's filter state is owned here so the right-side
// MatchDetailPanel (driven by `selection`) can paginate against the
// same narrowedRecords the view shows. Refs inside `matchesNarrow`
// don't auto-unwrap when passed as a prop bundle, but MatchesView
// destructures them into top-level setup vars on receipt — same
// CardStateApi convention as elsewhere in the app.
// The narrow filter + "since this match" anchor cluster lives in the matches
// store — it drives `selection` (detail panel) + the dossier off the same
// narrowedRecords the view shows. matchesNarrow / matchesNarrowState /
// matchAnchor are composable bundles (destructure directly; their inner refs
// don't auto-unwrap at object depth); searchClauses is a ref → storeToRefs.
const { matchesNarrowState, matchesNarrow } = matchesStore
const { searchClauses } = storeToRefs(matchesStore)
const activeFilterCount = matchesNarrow.activeClauseCount

// The detail card's narrow-chip toggle contract (isNarrowChipActive /
// toggleNarrowChip) lives in the matches store; the panel reads it directly.

// Anchor confirmation toast — fires on set + cleared transitions
// to bridge the cause-effect gap between the detail-panel button
// and the narrow-panel filter. `token` is the React-style fresh key
// so back-to-back changes reset the auto-dismiss window.
// Anchor "since this match" toast — set/clear + the view-filter jump.
const { anchorToast, onSetAnchor, onAnchorToastViewFilter, onAnchorToastDismiss } = useAnchorToast()
const selection = uiStore.selection

// Match mutations + the open-and-focus gesture are read inside MatchesView /
// MatchDetailPanel via their own useMatchActions() / UI-store calls now.

// MatchesView's left-side "Narrow this set" panel mirrors
// MatchDetailPanel's modal contract: while open, the background
// container + status bar go inert + aria-hidden. The view emits its
// open/close state up here so the inert binding picks it up
// alongside `selection.isOpen` and `showUnsupportedModal`.
const matchesNarrowOpen = ref(false)
function onMatchesNarrowOpen(open: boolean) {
  matchesNarrowOpen.value = open
}

// First-run modal — asks for the user's main account name on a
// fresh install. Forced gate: every other surface goes inert + aria-
// hidden while the modal is up so the user can't change any setting
// before naming their main account. ESC / backdrop intentionally do
// NOT close it. The composable persists the dismissal in localStorage
// so the modal never returns once acknowledged.
const { pending: firstRunPending, ack: ackFirstRun } = useFirstRunAcknowledged()
// Gate on the tour too — `it should not appear if the tour is
// starting or continuing on`. `tourActive` is seeded synchronously
// from the onboarding flag (see readTourWillOpen above), so on a
// fresh install where both flags are unset the tour wins the first
// paint; once the user finishes / skips the tour, `tourActive`
// flips false and the modal surfaces. `firstRunPending` itself ANDs
// localStorage acknowledgement with the active-profile-is-default
// check — see useFirstRunAcknowledged.
const firstRunModalOpen = computed(() => firstRunPending.value && !tourActive.value)

// Every modal surface that should freeze the background. Used by
// the masthead container + status bar to flip `inert` + aria-hidden
// so screen readers + Tab nav don't bleed into the dimmed page.
// Add to this list whenever you mount a new full-surface modal.
const backgroundFrozen = computed(() =>
  firstRunModalOpen.value
  || showUnsupportedModal.value
  || showStartupErrorModal.value
  || selection.isOpen.value
  || matchesNarrowOpen.value
  || showManualMatchModal.value,
)

function onFirstRunDismiss(renamedTo: string | null) {
  ackFirstRun()
  // If the user renamed the active profile, the server tore down +
  // re-init'd the SQLite store at the new directory — same teardown
  // as the masthead chip's switch/create/rename flow. Mirror that
  // flow's window.location.reload() so every composable (including
  // ProfileSwitcher's onMounted GetProfiles()) re-fetches against
  // the renamed profile. A targeted refresh isn't enough: profile
  // state is owned by the chip, not App.vue.
  if (renamedTo !== null) {
    window.location.reload()
  }
}

// Step 2 of the first-run modal: the user clicked a "found" source
// card. Commit the path through the existing setScreenshotsDir flow
// (same writer the Settings picker uses) — the modal emits dismiss
// in lockstep so the localStorage gate flips on the same turn.
async function onFirstRunPickSource(path: string) {
  await pickDetectedSource(path)
}

// Step 2 of the first-run modal: the user clicked the custom-pick
// tile. Trigger the native folder dialog (or window.prompt in the
// server-mode fallback) and, on a successful pick, commit + ack the
// first-run gate so the modal unmounts. Cancel leaves the modal on
// step 2 so the user can try again.
async function onFirstRunPickCustomSource() {
  try {
    await pickDir()
    if (screenshotsDir.value) {
      ackFirstRun()
    }
  } catch (e) {
    setErrorFromRaw(String(e))
  }
}

// Search → panel auto-track. When the panel is open AND the user
// is actively searching (any clauses parsed), the panel selection
// follows the first narrowed match so the highlighted content is
// visible without an extra click. The watcher fires on every
// searchText change while the panel is open; when the user clears
// the search, we leave the selection where it last landed (don't
// snap back to a previous match — that would surprise the user).
// `narrowedRecords` IS the search-aware list now that the legacy
// `filters.filteredSorted` is gone — same dimensions, no second
// independent filter pipeline to keep in sync.
watch(
  () => matchesNarrowState.searchText.value,
  () => {
    if (!selection.isOpen.value) return
    if (searchClauses.value.length === 0) return
    const first = matchesNarrow.narrowedRecords.value[0]
    if (first && first.match_key !== selection.selectedKey.value) {
      selection.open(first.match_key)
    }
  },
)


// Open the Matches detail panel for a given match key + scroll the
// source row into view behind it so the user doesn't lose their
// place. Used by Matches-view keyboard shortcuts ('e' / 't'); the
// Unknown tab uses its own local toggleUnknownExpand below.
async function toggleExpand(id: string) {
  selection.open(id)
  await nextTick()
  const el = document.getElementById(`match-${id}`)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

// W-L-D summary that reflects the *currently narrowed* set so the user
// can see, for instance, "support role on Aatlis: 6W 2L 0D" by setting
// the matching filters. Sources from MatchesView's `narrowedRecords`
// so this stays in sync with the MatchesView dossier's Record KPI
// tile. Honors the same `leaver-exclude-tally` rule the dossier
// applies.
const wld = computed(() => tallyWLD(
  matchesNarrow.narrowedRecords.value,
  matchesNarrow.leaverHandling.value === 'exclude-tally',
))

// Per-card source-preview/expand state (the CardStateApi bundle) + the
// triage actions live inside UnknownMapsView now — it's the only consumer.

// ── Keyboard shortcuts — full registry ─────────────────────────
// Hoisted to useGlobalKeyboard so App.vue stops carrying the
// ~100-line registry inline. The composable still installs a
// single capture-phase document listener via useKeyboardShortcuts;
// per-binding `when` predicates gate view-specific shortcuts.
// `suppressed: openCheatsheet` is wired inside the composable.
// See FEATURES.md for the cheatsheet contract.
useGlobalKeyboard({
  view,
  openCheatsheet,
  selectionIsOpen: selection.isOpen,
  selectedKey: selection.selectedKey,
  closeSelection: selection.close,
  focusedCardIndex,
  narrowedRecords: matchesNarrow.narrowedRecords,
  goToView,
  focusCardByRenderedDelta,
  focusCardByRenderedEnd,
  focusSectionByRenderedDelta,
  toggleExpand,
})

// Keep TAB_ORDER referenced so a future tab addition can lint-check
// the g-prefix coverage above. (Each entry in TAB_ORDER must have a
// matching g+x handler.)
void TAB_ORDER

// The derived triage lists (unknown / reference-gap / hidden / ambiguous)
// are getters on the matches store, destructured above.

// Pure helpers (detectScreenshotSlots, screenshotURL, etc.) live in
// ./match-helpers.ts so they can be unit-tested in isolation.

// fmtTime is imported from ./match-helpers.js (extracted for testing).

// App-shell-local overlay state bundled for AppOverlays: the modal flags App
// also reads for its background-freeze (`inert`) computed, plus the toast/tour
// handlers that reach into the DOM + view nav. Everything store-backed,
// AppOverlays reads from the stores directly.
const overlaysApi: OverlaysApi = {
  anchorToast,
  onSetAnchor,
  onAnchorToastViewFilter,
  onAnchorToastDismiss,
  showStartupErrorModal,
  startupErrorMessage,
  openCheatsheet,
  closeCheatsheet: () => { openCheatsheet.value = false },
  showManualMatchModal,
  closeManualMatch: () => { showManualMatchModal.value = false },
  onManualMatchCreated,
  firstRunModalOpen,
  screenshotCandidates,
  probing,
  onFirstRunDismiss,
  onFirstRunPickSource,
  onFirstRunPickCustomSource,
  exportBundleOpen,
  exportBundleSelectedKeys,
  closeExportBundle: () => { exportBundleOpen.value = false },
  onExportBundleConfirm,
  onTourSeedAndSwitch,
  onTourActiveChange,
  onTourOpenNarrow,
  onTourCloseNarrow,
  onTourApplyHeroFilter,
  onTourClearFilters,
}

// Subscribe to the watcher's parse-complete event so the records list
// auto-refreshes when an auto-parse runs in the background. Without
// this the user would have to click Parse manually to see new matches
// land in the UI even though the data is already in SQLite.

onMounted(() => {
  // Restore last-parse timestamp so the Settings page shows the right
  // "Last run · …" hint immediately on launch, not just after a fresh
  // parse in the current session.
  try {
    const v = localStorage.getItem('recall.lastParsedAt')
    if (v) lastParsedAt.value = Number(v) || null
  } catch (_) {}

  void appStore.loadVersion()
  // CheckForUpdate is no longer called on mount — it's gated behind
  // the "Check for updates" button in the masthead's ver-block. See
  // checkForUpdates() below + the v-if chain on .ver-block.
  load()
  void loadIgnored()
  void loadScreenshotCandidates()
  // Surface any captured Startup failure. The Wails wrapper used to
  // log.Fatal on profile / DB-init errors, which manifested as a
  // window flash with no user-visible reason. Startup now records
  // the failure on the App; we pull it here on mount and flip the
  // blocking modal so the user sees a real message.
  GetStartupError()
    .then(msg => { if (msg) startupErrorMessage.value = msg })
    .catch(() => {})
})

// Polite live-region announcement for the parse lifecycle. The
// ParseStatusBar already lights up an aria-live region during a
// run (counter + filename), but it goes inert when the bar hides
// at the end of the run — screen-reader users got no signal for
// "parse complete." Setting + clearing this ref drives an sr-only
// status region so the announcement fires once per terminal state.
// The ingest event stream (parse-complete/cancelled handlers + sr-only
// announce) + parse-recovery live in the matches store.
</script>

<template>
  <div class="app">
    <!-- Skip-link: first focusable on the page so keyboard users can
         bypass the masthead and nav tabs on every load. Visually hidden
         until focused, then snaps in over the top-left corner. -->
    <a class="skip-link" href="#main-content" @click="focusMain">Skip to main content</a>

    <!-- Polite parse-lifecycle announcer. Sets briefly on
         parse-complete + parse-cancelled, then clears so the next
         terminal state re-announces. Invisible to sighted users —
         the masthead chip + status bar carry the visual signal. -->
    <div class="sr-only" role="status" aria-live="polite">
      {{ parseAnnouncement }}
    </div>

    <div class="atmos" aria-hidden="true" />
    <div class="grid-lines" aria-hidden="true" />

    <div class="container" :inert="backgroundFrozen || undefined" :aria-hidden="backgroundFrozen ? 'true' : undefined">
      <!-- System Alert: blocks both Matches and Settings flow when the
           OCR engine isn't usable. Renders ABOVE the masthead so it's
           the first thing a user sees on a broken install. -->
      <SystemAlertBanner
        v-if="!tesseractReady"
        :path="tesseractStatus.path"
        :error="tesseractStatus.error"
        @fix="gotoEngineSettings"
      />

      <AppMasthead
        :view="view"
        :active-filter-count="activeFilterCount"
        :unknown-count="unknownRecords.length"
        :parse-progress="parseProgress"
        :records-count="records.length"
        :wld="wld"
        :records-pulse="recordsPulse"
        :app-version="appVersion"
        :update-check-busy="updateCheckBusy"
        :has-update-info="!!updateInfo"
        :on-tab-keydown="onTabKeydown"
        @go-to-view="goToView"
        @check-updates="checkForUpdates"
      />

      <UpdateReminderBanner
        :open="showUpdateReminder"
        :days-since-last-check="updateReminderDays"
        @check="checkForUpdates"
        @dismiss="dismissUpdateReminder"
      />

      <ErrorBanner
        v-if="error"
        :message="error"
        :can-retry="!!errorRetry"
        @retry="errorRetry?.()"
        @dismiss="clearError"
      />

      <!-- <main> is the page's primary landmark. The skip-link at the
           top of .app jumps focus here so keyboard users can bypass the
           masthead and tablist on every load. tabindex="-1" lets us
           focus it programmatically without putting it in the natural
           tab order. -->
      <main id="main-content" tabindex="-1">
        <!-- ─── SETTINGS VIEW (folder + theme — minimal config) ──── -->
        <!-- Reads folders/engine/appearance/calendar + backup/clear/source-picker from the stores. -->
        <SettingsView v-if="view === 'settings'" />

        <!-- ─── PARSE VIEW (Watch + Manual Parse + Progress) ─────── -->
        <!-- Reads parse state from the matches store + Tesseract/watch from
             settings directly. -->
        <IngestView v-if="view === 'ingest'" />

        <!-- ─── UNKNOWN MAPS VIEW ────────────────────────────────── -->
        <!-- Reads its triage lists + card state + actions from the stores. -->
        <UnknownMapsView v-if="view === 'unknown'" />

        <!-- ─── MATCHES VIEW ───────────────────────────────────── -->
        <!-- First paint: render skeleton leaf-rows until the initial
             /api/v1/matches roundtrip lands. The skeleton mirrors the
             real .leaf-row grid so the page geometry doesn't shift. -->
        <MatchesSkeleton
          v-if="view === 'matches' && firstLoadPending && records.length === 0"
        />
        <!-- Reads records/narrow + selection + the mutations from the stores;
             App keeps the shell-coupled events (manual-match modal, narrow-open
             inert, the anchor toast, export-bundle/CSV flows). -->
        <MatchesView
          v-else-if="view === 'matches'"
          @add-match="showManualMatchModal = true"
          @narrow-open="onMatchesNarrowOpen"
          @export-bundle="onExportBundleRequest"
          @export-csv="onExportMatchesCSV"
          @clear-anchor="onSetAnchor('')"
          @set-anchor="onSetAnchor"
        />
      </main>
    </div>

    <!-- Persistent parse-status footer — visible from every tab while a
         parse is in flight; slides off-bottom 1.5 s after completion.
         Click anywhere on it to jump to the Ingest tab for the detailed
         log view. -->
    <ParseStatusBar
      :parse-progress="parseProgress"
      :parse-log="parseLog"
      :cancelling-parse="cancellingParse"
      :inert="backgroundFrozen || undefined"
      :aria-hidden="backgroundFrozen ? 'true' : undefined"
      @go-to-view="goToView"
      @cancel-parse="onCancelParse"
    />

    <!-- Floating overlay cluster — modals, the detail panel, lightbox, toasts,
         and the first-launch tour. AppOverlays reads its store-backed state
         directly; the App-shell-local flags (which App also needs for its
         background-freeze computed) + the DOM/view-nav handlers arrive as the
         `overlaysApi` bundle. -->
    <AppOverlays :api="overlaysApi" />
  </div>
</template>

