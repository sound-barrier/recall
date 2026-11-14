import { computed, markRaw, ref, shallowRef, type Ref } from 'vue'

import type { ActiveRun, MatchRecord, RunFinishedEvent, RunKind } from '@/api-client'
import { ParseScreenshots, ReParseAll, CancelParse } from '@/api-client'
import { getQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'
import type { ParseProgressEvent, ParseRunSummary, WatchActivityEvent } from '@/components/ingest/parse-progress'
import {
  initialParseRunState,
  isCancelableKind,
  stepParseRun,
  type ParseRunEffect,
  type ParseRunEvent,
  type ParseRunState,
  type ParseRunStep,
} from '@/composables/ingest/parseRunMachine'
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
  // The run, as one closed set of states (parseRunMachine.ts). Only
  // dispatch() assigns it; everything below that the UI reads about the
  // run is derived from it.
  const machine = shallowRef<ParseRunState>(initialParseRunState)
  const parseRun = computed(() => machine.value.run)
  // parseBusy gates the manual Parse button + peers: something holds the
  // run slot, or our own start is in flight.
  const parseBusy = computed(() => parseRun.value.status !== 'idle')
  const cancelingParse = computed(() => parseRun.value.status === 'canceling')
  // parseProgress: the run's most recent tick (null when idle, and for a
  // store swap, which has no files to count).
  const parseProgress = computed<ParseProgressEvent | null>(() => {
    const run = parseRun.value
    return run.status === 'running' || run.status === 'canceling' ? run.progress : null
  })
  // parseLog: rolling completed-file log of the run being watched.
  const parseLog = ref<ParseProgressEvent[]>([])
  const logCap = 50
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
  // End-of-run outcome toast: the run's own tally off the
  // completed run's run-finished payload ("4 read · 2 failed to read"), shown from
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
  // The run's end (load() + back to idle) arrives as its run-finished
  // event, NOT the POST resolving, so a mid-parse network drop can't strand
  // the panel. parseProgressOpen is IngestView's drawer; the
  // unsupported-Tesseract confirm modal gates a run on an untested engine.
  const parseProgressOpen = ref(false)
  const showUnsupportedModal = ref(false)

  // Stop takes Run's place on the same spot, so the second click of a
  // double-click on Run would land on Stop and cancel the run it just
  // started. Stop stays held for a beat after a start this client asked for.
  const STOP_HOLD_MS = 600
  const stopHeld = ref(false)
  let stopHoldTimer: ReturnType<typeof setTimeout> | null = null
  function holdStop() {
    if (stopHoldTimer) clearTimeout(stopHoldTimer)
    stopHeld.value = true
    stopHoldTimer = setTimeout(() => { stopHeld.value = false; stopHoldTimer = null }, STOP_HOLD_MS)
  }
  const canStop = computed(() => {
    const run = parseRun.value
    return run.status === 'running' && isCancelableKind(run.kind) && !stopHeld.value
  })

  function dispatch(event: ParseRunEvent): ParseRunStep {
    const step = stepParseRun(machine.value, event)
    if (!step.ok) return step
    machine.value = step.state
    if (step.effect) void onRunEffect(step.effect)
    return step
  }

  async function startRun(start: () => Promise<{ run_id: number }>, kind: RunKind) {
    const appStore = useAppStore()
    appStore.clearError()
    if (!dispatch({ type: 'start-requested' }).ok) return
    holdStop()
    parseLog.value = []
    parseProgressOpen.value = false
    try {
      const { run_id: runId } = await start()
      dispatch({ type: 'start-accepted', runId, kind })
    } catch (e) {
      appStore.setErrorFromRaw(String(e))
      dispatch({ type: 'start-rejected' })
    }
  }

  async function runParse() {
    if (!guardWrite()) return
    await startRun(ParseScreenshots, 'parse')
  }

  // Stop from IngestView's button OR the status-bar ABORT tile. The run
  // reads canceling at once; its run-finished returns it to idle. A refused
  // cancel (the run ended first) puts it back to running until that event.
  async function onCancelParse() {
    const run = parseRun.value
    if (!canStop.value || run.status !== 'running') return
    if (!dispatch({ type: 'cancel-requested' }).ok) return
    try {
      await CancelParse()
    } catch (_) {
      dispatch({ type: 'cancel-rejected', runId: run.runId })
    }
  }

  // "Re-parse all" (Settings → Advanced) — forces re-OCR; skips the
  // unsupported-version modal (the user committed to a multi-minute run).
  async function onReParseAll() {
    if (!guardWrite()) return
    if (!useSettingsStore().tesseractReady) {
      useAppStore().setError("Tesseract isn't set up yet. Open Settings → Engine to configure it.")
      return
    }
    await startRun(ReParseAll, 'reparse')
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

  // ── Run-end reporting ─────────────────────────────────────────────
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

  // ── Server events → the machine ───────────────────────────────────
  function onParseProgress(event: ParseProgressEvent) {
    if (!dispatch({ type: 'progress', event }).ok) return
    parseLog.value = [...parseLog.value, event].slice(-logCap)
  }

  function onRunFinished(event: RunFinishedEvent) {
    dispatch({ type: 'finished', event })
  }

  // The resync path: a snapshot read at `generation` applies only if the
  // run has not changed since the read began.
  function applySnapshot(active: ActiveRun, generation: number) {
    dispatch({ type: 'snapshot', active, generation })
  }
  function runGeneration(): number {
    return machine.value.generation
  }

  async function onRunEffect(effect: ParseRunEffect) {
    switch (effect.type) {
      case 'ended':
        await finishRun(effect.finished)
    }
  }

  // A run ended: reload what it wrote, then say how it went. A run whose
  // end event was lost (found idle on resync) has no outcome to report.
  async function finishRun(finished: RunFinishedEvent | null) {
    await deps.load()
    if (!finished || !isCancelableKind(finished.kind)) return
    switch (finished.outcome) {
      case 'completed':
        reportCompletedParse(finished.summary)
        return
      case 'canceled':
        announceParse('Parse canceled.')
        return
      case 'failed':
        useAppStore().setErrorFromRaw(finished.error ?? 'The parse stopped unexpectedly.')
        announceParse('Parse failed.')
    }
  }

  function reportCompletedParse(summary?: ParseRunSummary) {
    // Read the fresh records straight from the cache — the observer's
    // reactive ref updates a notification tick later than the refetch
    // resolves, and the session summary must see the new batch.
    const fresh = getQueryClient().getQueryData<MatchRecord[]>(qk.matches) ?? []
    raiseRunToasts(fresh, summary)
    lastParsedAt.value = Date.now()
    try { localStorage.setItem(profileScopedKey('lastParsedAt'), String(lastParsedAt.value)) } catch (_) { /* non-fatal */ }
    announceCompletion(fresh.length, summary?.files_failed ?? 0)
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
    parseRun,
    parseBusy,
    cancelingParse,
    canStop,
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
    onParseProgress,
    onRunFinished,
    applySnapshot,
    runGeneration,
    parseConnectionState,
    refreshParse,
    wireParseRecovery,
  }
}
