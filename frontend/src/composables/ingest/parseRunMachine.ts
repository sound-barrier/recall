import type { ActiveRun, RunFinishedEvent, RunId, RunKind } from '@/client/types.gen'
import type { ParseProgressEvent } from '@/components/ingest/parse-progress'

// The parse run as this client sees it — one closed set of states and the
// one function that moves between them. Nothing else assigns the state: the
// lifecycle composable dispatches events here and derives everything the UI
// reads (busy, canceling, the live progress tick) from the result.
//
// Every event that names a run carries its id. Run ids grow for the life of
// the server and are never reused, so `finishedThrough` — the newest run this
// client saw end — is enough to drop a late progress tick, a replayed end, or
// a resync snapshot taken before the end arrived.

export type ParseRunStatus =
  | { status: 'idle' }
  // Run Parse was clicked; POST /parses has not answered yet.
  | { status: 'starting' }
  | { status: 'running'; runId: RunId; kind: RunKind; progress: ParseProgressEvent | null }
  | { status: 'canceling'; runId: RunId; kind: RunKind; progress: ParseProgressEvent | null }

export interface ParseRunState {
  run: ParseRunStatus
  finishedThrough: RunId
  // Bumped on every change of status or run (not on a progress tick): a
  // resync snapshot requested at one generation is stale at the next.
  generation: number
}

export type ParseRunEvent =
  | { type: 'start-requested' }
  | { type: 'start-accepted'; runId: RunId; kind: RunKind }
  | { type: 'start-rejected' }
  | { type: 'progress'; event: ParseProgressEvent }
  | { type: 'finished'; event: RunFinishedEvent }
  | { type: 'cancel-requested' }
  | { type: 'cancel-rejected'; runId: RunId }
  | { type: 'snapshot'; active: ActiveRun; generation: number }

// What a transition asks of whoever drives the machine.
export type ParseRunEffect =
  // A run ended. `finished` is its event when one arrived; a resync that
  // found the slot idle has none to give.
  | { type: 'ended'; runId: RunId; finished: RunFinishedEvent | null }

export type ParseRunStep =
  | { ok: true; state: ParseRunState; effect: ParseRunEffect | null }
  // `stale`: the event names a run already over, or a snapshot taken
  // before the last change. `illegal`: the event cannot apply in this state.
  // Either way the state is unchanged.
  | { ok: false; state: ParseRunState; reason: 'stale' | 'illegal' }

export const initialParseRunState: ParseRunState = {
  run: { status: 'idle' },
  finishedThrough: 0,
  generation: 0,
}

/** Whether the server lets a run of this kind be canceled. */
export function isCancelableKind(kind: RunKind): boolean {
  return kind === 'parse' || kind === 'reparse'
}

function moved(state: ParseRunState, run: ParseRunStatus, effect: ParseRunEffect | null = null): ParseRunStep {
  return { ok: true, state: { ...state, run, generation: state.generation + 1 }, effect }
}

function refused(state: ParseRunState, reason: 'stale' | 'illegal'): ParseRunStep {
  return { ok: false, state, reason }
}

function runIdOf(run: ParseRunStatus): RunId | null {
  return run.status === 'running' || run.status === 'canceling' ? run.runId : null
}

function onStartRequested(state: ParseRunState): ParseRunStep {
  return state.run.status === 'idle' ? moved(state, { status: 'starting' }) : refused(state, 'illegal')
}

function onStartRejected(state: ParseRunState): ParseRunStep {
  return state.run.status === 'starting' ? moved(state, { status: 'idle' }) : refused(state, 'stale')
}

function onStartAccepted(state: ParseRunState, runId: RunId, kind: RunKind): ParseRunStep {
  if (runId <= state.finishedThrough) return refused(state, 'stale')
  const { run } = state
  switch (run.status) {
    case 'starting':
      return moved(state, { status: 'running', runId, kind, progress: null })
    case 'running':
    case 'canceling':
      // A progress tick beat the POST's answer and adopted the run first.
      if (run.runId !== runId) return refused(state, 'illegal')
      return { ok: true, state: { ...state, run: { ...run, kind } }, effect: null }
    case 'idle':
      return refused(state, 'illegal')
  }
}

function onProgress(state: ParseRunState, event: ParseProgressEvent): ParseRunStep {
  if (event.run_id <= state.finishedThrough) return refused(state, 'stale')
  const { run } = state
  switch (run.status) {
    case 'running':
    case 'canceling':
      if (run.runId === event.run_id) {
        return { ok: true, state: { ...state, run: { ...run, progress: event } }, effect: null }
      }
      // A newer run is ticking, so the one we held ended with its event
      // lost; adopt the new one.
      return moved({ ...state, finishedThrough: run.runId },
        { status: 'running', runId: event.run_id, kind: 'parse', progress: event },
        { type: 'ended', runId: run.runId, finished: null })
    case 'idle':
    case 'starting':
      // A run this client did not start (the folder watcher, another tab),
      // or ours ticking before the POST answered. Progress only comes from
      // a parse; start-accepted corrects the kind for a re-parse.
      return moved(state, { status: 'running', runId: event.run_id, kind: 'parse', progress: event })
  }
}

function onFinished(state: ParseRunState, event: RunFinishedEvent): ParseRunStep {
  if (event.run_id <= state.finishedThrough) return refused(state, 'stale')
  const held = runIdOf(state.run)
  if (held !== null && held > event.run_id) return refused(state, 'stale')
  return moved({ ...state, finishedThrough: event.run_id }, { status: 'idle' },
    { type: 'ended', runId: event.run_id, finished: event })
}

function onCancelRequested(state: ParseRunState): ParseRunStep {
  const { run } = state
  if (run.status !== 'running' || !isCancelableKind(run.kind)) return refused(state, 'illegal')
  return moved(state, { ...run, status: 'canceling' })
}

function onCancelRejected(state: ParseRunState, runId: RunId): ParseRunStep {
  const { run } = state
  if (run.status !== 'canceling' || run.runId !== runId) return refused(state, 'stale')
  return moved(state, { ...run, status: 'running' })
}

function snapshotProgress(active: Extract<ActiveRun, { state: 'running' | 'canceling' }>): ParseProgressEvent | null {
  if (!isCancelableKind(active.kind)) return null
  // The snapshot has no per-file detail; the wire always carries both
  // fields, so they are empty rather than absent.
  return { run_id: active.run_id, done: active.done, total: active.total, filename: '', screenshot_type: '' }
}

function onSnapshot(state: ParseRunState, active: ActiveRun, generation: number): ParseRunStep {
  if (generation !== state.generation) return refused(state, 'stale')
  const held = runIdOf(state.run)
  if (active.state === 'idle') {
    // Still waiting on our own POST: the slot is not ours yet.
    if (held === null) return { ok: true, state, effect: null }
    // The run we held ended while its event was lost.
    return moved({ ...state, finishedThrough: held }, { status: 'idle' },
      { type: 'ended', runId: held, finished: null })
  }
  if (active.run_id <= state.finishedThrough) return refused(state, 'stale')
  const progress = snapshotProgress(active)
  const run: ParseRunStatus = { status: active.state, runId: active.run_id, kind: active.kind, progress }
  if (held !== null && held !== active.run_id) {
    return moved({ ...state, finishedThrough: held }, run, { type: 'ended', runId: held, finished: null })
  }
  return moved(state, run)
}

/** The one transition function: the next state, and what it asks for. */
export function stepParseRun(state: ParseRunState, event: ParseRunEvent): ParseRunStep {
  switch (event.type) {
    case 'start-requested':
      return onStartRequested(state)
    case 'start-accepted':
      return onStartAccepted(state, event.runId, event.kind)
    case 'start-rejected':
      return onStartRejected(state)
    case 'progress':
      return onProgress(state, event.event)
    case 'finished':
      return onFinished(state, event.event)
    case 'cancel-requested':
      return onCancelRequested(state)
    case 'cancel-rejected':
      return onCancelRejected(state, event.runId)
    case 'snapshot':
      return onSnapshot(state, event.active, event.generation)
  }
}
