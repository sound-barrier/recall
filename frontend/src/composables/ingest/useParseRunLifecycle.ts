import { computed, markRaw, ref, shallowRef, type Ref } from 'vue'

import type { MatchRecord } from '@/api-client'
import { ParseScreenshots, ReParseAll, CancelParse } from '@/api-client'
import { getQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'
import type { ParseProgressEvent, ParseRunSummary, WatchActivityEvent } from '@/components/ingest/parse-progress'
import { currentSessionSummary, type SessionSummary } from '@/match/dossier/match-momentum-helpers'
import { profileScopedKey } from '@/composables/profile/profileStorage'
import { useWriteGate } from '@/composables/shared/useWriteGate'
import type { ParseConnectionState } from '@/composables/ingest/useParseRecovery'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'

// The parse-run lifecycle cluster the matches store composes: run/stop
// controls, progress + announcement state, the terminal transitions the
// server events drive, and the stream-recovery bridge. Extracted as a
// plain module function (no component lifecycle hooks) so the store
// stays the single owner of the refs it returns — the store spreads
// this bundle into its public surface under the SAME names.

/** What the lifecycle needs from its host store. */
export interface ParseRunDeps {
  /** The awaitable cluster refetch (the store's `load`). */
  load: () => Promise<void>
}

export function useParseRunLifecycle(deps: ParseRunDeps) {
  // A user-initiated run is a write (it adds matches); the background
  // folder watcher is NOT gated — it only ever writes the coach's own
  // screenshots into the coach's own database. What it must not do during
  // a session is TALK: the toast, the tally and the polite announcement
  // all belong to a corpus the user isn't looking at.
  const { guardWrite, sessionActive } = useWriteGate()
  // parseBusy gates the manual Parse button + peers; cancelingParse spans
  // the Stop click → SSE parse-canceled confirmation.
  const parseBusy = ref(false)
  const cancelingParse = ref(false)
  // parseProgress: most-recent completed file during an active parse (null
  // when idle). parseLog: rolling completed-file log.
  const parseProgress = ref<ParseProgressEvent | null>(null)
  // Watcher pending-file tally (masthead dot). Event-fed, session-scoped.
  const watchActivity = ref<WatchActivityEvent | null>(null)
  // Post-parse session tally toast: set when a parse completes while
  // the freshest matches form an ACTIVE session (see
  // currentSessionSummary); token restarts the toast timer per run.
  const sessionToast = ref<(SessionSummary & { token: number }) | null>(null)
  // The session ITSELF, separate from the toast that reports it. Dismissing
  // the tally does not end the session, and anything else that wants to know
  // a session is live (the focus readout) must not read that dismissal as
  // "no session" — which is exactly what reading sessionToast would say.
  const currentSession = ref<SessionSummary | null>(null)
  // Dismissal sticks to the SESSION, not to the toast instance. Keyed on the
  // token, "×" survived exactly one game: the next parse built a fresh token
  // and put the same readout back, all evening, re-announcing itself to a
  // screen reader every time. Same shape as useTiltNudge's streakKey — the
  // session you dismissed stays dismissed, a NEW session may speak up. Nothing
  // persists across launches, deliberately.
  const dismissedSessionStart = ref<number | null>(null)
  function dismissSessionToast(token: number) {
    if (sessionToast.value?.token !== token) return
    dismissedSessionStart.value = sessionToast.value.startedAt
    sessionToast.value = null
  }
  const parseLog = ref<ParseProgressEvent[]>([])
  // End-of-run outcome toast: the run's own tally off the
  // parse-complete payload ("4 read · 2 failed to read"), shown from
  // any tab because the watcher can finish a run anywhere. Muted in a
  // coach session like every other run-side voice; absent when the
  // event carried no summary (legacy shape / missed event). The token
  // restarts the toast timer per run.
  const parseOutcome = ref<(ParseRunSummary & { token: number }) | null>(null)
  function dismissParseOutcome(token: number) {
    if (parseOutcome.value?.token !== token) return
    parseOutcome.value = null
  }
  // Wall-clock of the last successful manual parse → Settings "Last run · X".
  const lastParsedAt = ref<number | null>(null)

  // Restore the persisted last-parse timestamp on boot so Settings shows
  // "Last run · …" immediately, not just after a fresh parse this session. This
  // cluster owns lastParsedAt, so it owns its hydration too.
  function restoreLastParsedAt() {
    try {
      // Profile-scoped, with one-way adoption of the pre-scoping
      // global key so an upgrading install keeps its timestamp.
      const v = localStorage.getItem(profileScopedKey('lastParsedAt'))
        ?? localStorage.getItem('recall.lastParsedAt')
      if (v) lastParsedAt.value = Number(v) || null
    } catch (_) { /* private-mode localStorage */ }
  }

  // ── Parse run controls ────────────────────────────────────────────
  // Completion (load() + parseBusy=false) arrives via the parse-complete
  // event handler, NOT the POST resolving, so a mid-parse network drop can't
  // strand the panel. parseProgressOpen is IngestView's drawer; the
  // unsupported-Tesseract confirm modal gates a run on an untested engine.
  const parseProgressOpen = ref(false)
  const showUnsupportedModal = ref(false)

  async function runParse() {
    if (!guardWrite()) return
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
      cancelingParse.value = false
    }
  }

  // Stop from IngestView's button OR the status-bar ABORT tile. Flips the
  // canceling flag immediately; the clear happens on parse-canceled.
  // Swallows 409 (parse finished before the Stop landed).
  async function onCancelParse() {
    if (cancelingParse.value) return
    cancelingParse.value = true
    try {
      await CancelParse()
    } catch (_) {
      cancelingParse.value = false
    }
  }

  // "Re-parse all" (Settings → Advanced) — forces re-OCR; skips the
  // unsupported-version modal (the user committed to a multi-minute run).
  async function onReParseAll() {
    if (!guardWrite()) return
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
      cancelingParse.value = false
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

  // ── Ingest event stream ───────────────────────────────────────────
  // Polite sr-only announcement for parse-lifecycle terminal states (the
  // status bar goes inert at run end, leaving screen readers no signal).
  const parseAnnouncement = ref('')
  function announceParse(msg: string) {
    if (sessionActive.value) return
    parseAnnouncement.value = msg
    setTimeout(() => { if (parseAnnouncement.value === msg) parseAnnouncement.value = '' }, 2000)
  }

  // ── Parse-run terminal transitions ────────────────────────────────
  // The store owns the state, so it owns the transitions; useServerEvents
  // merely wires the parse-complete / parse-canceled events to these.
  // The two run-side toasts a completed run raises: the session tally
  // (when the fresh batch forms an active session that wasn't
  // dismissed) and the outcome report (when the event carried one).
  // Both stay silent during a coach session.
  function raiseRunToasts(fresh: MatchRecord[], summary?: ParseRunSummary) {
    const session = sessionActive.value ? null : currentSessionSummary(fresh)
    currentSession.value = session
    const dismissed = session !== null && session.startedAt === dismissedSessionStart.value
    sessionToast.value = session && !dismissed ? { ...session, token: Date.now() } : null
    parseOutcome.value = summary && !sessionActive.value
      ? { ...summary, token: Date.now() }
      : null
  }

  function announceCompletion(matchCount: number, failed: number) {
    const failedClause = failed > 0 ? ` ${failed} file${failed === 1 ? '' : 's'} failed to read.` : ''
    announceParse(`Parse complete. ${matchCount} match${matchCount === 1 ? '' : 'es'} loaded.${failedClause}`)
  }

  async function finishParseRun(outcome: 'complete' | 'canceled', summary?: ParseRunSummary) {
    await deps.load()
    // Read the fresh records straight from the cache — the observer's
    // reactive ref updates a notification tick later than the refetch
    // resolves, and the session summary must see the new batch.
    const fresh = getQueryClient().getQueryData<MatchRecord[]>(qk.matches) ?? []
    if (outcome === 'complete') {
      raiseRunToasts(fresh, summary)
      lastParsedAt.value = Date.now()
      try { localStorage.setItem(profileScopedKey('lastParsedAt'), String(lastParsedAt.value)) } catch (_) { /* non-fatal */ }
      announceCompletion(fresh.length, summary?.files_failed ?? 0)
    } else {
      announceParse('Parse canceled.')
    }
    parseBusy.value = false
    parseProgress.value = null
    cancelingParse.value = false
  }

  // ── Parse-stream recovery surface ─────────────────────────────────
  // The recovery state machine and the event-stream subscriptions live in
  // useServerEvents (App shell — they register component lifecycle hooks);
  // the store carries their consumer-facing surface so IngestView keeps
  // reading one place. The bridge is a reactive holder (not a mutable
  // callback slot), so the computed chains straight to the recovery
  // state with no scope-bound sync effect; before App wires it the state
  // reads 'connected' and refresh is a no-op — same as Wails mode, where
  // the recovery machinery never fires.
  const parseRecoveryBridge = shallowRef<{
    connectionState: Ref<ParseConnectionState>
    refresh: () => void
  } | null>(null)
  const parseConnectionState = computed<ParseConnectionState>(
    () => parseRecoveryBridge.value?.connectionState.value ?? 'connected',
  )
  function wireParseRecovery(bridge: { connectionState: Ref<ParseConnectionState>; refresh: () => void }) {
    parseRecoveryBridge.value = markRaw(bridge)
  }
  function refreshParse() { parseRecoveryBridge.value?.refresh() }

  return {
    parseBusy,
    cancelingParse,
    parseProgress,
    watchActivity,
    sessionToast,
    currentSession,
    dismissSessionToast,
    parseOutcome,
    dismissParseOutcome,
    parseLog,
    lastParsedAt,
    restoreLastParsedAt,
    parseProgressOpen,
    showUnsupportedModal,
    onCancelParse,
    onReParseAll,
    parse,
    confirmUnsupportedParse,
    parseAnnouncement,
    announceParse,
    finishParseRun,
    parseConnectionState,
    refreshParse,
    wireParseRecovery,
  }
}
