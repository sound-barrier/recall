import { describe, expect, it } from 'vitest'

import type { RunFinishedEvent } from '@/api-client'
import type { ParseProgressEvent } from '@/components/ingest/parse-progress'
import {
  initialParseRunState,
  stepParseRun,
  type ParseRunEvent,
  type ParseRunState,
  type ParseRunStatus,
} from '@/composables/ingest/parseRunMachine'

// The transition table, pinned: every legal move, every refused one, and
// the stale events (an old run's tick or end, a snapshot read before the
// last change) that must leave the state exactly as it was.

const tick = (runId: number, done = 1): ParseProgressEvent =>
  ({ run_id: runId, done, total: 4, filename: 'a.png', screenshot_type: 'teams' })
const finished = (runId: number, outcome: RunFinishedEvent['outcome'] = 'completed'): RunFinishedEvent =>
  ({ run_id: runId, kind: 'parse', outcome })

function at(run: ParseRunStatus, finishedThrough = 0): ParseRunState {
  return { run, finishedThrough, generation: 5 }
}
const idle = at({ status: 'idle' })
const starting = at({ status: 'starting' })
const running = (runId = 3, kind: 'parse' | 'restore' = 'parse') =>
  at({ status: 'running', runId, kind, progress: null }, 2)
const canceling = (runId = 3) => at({ status: 'canceling', runId, kind: 'parse', progress: null }, 2)

function moves(from: ParseRunState, event: ParseRunEvent) {
  const step = stepParseRun(from, event)
  if (!step.ok) throw new Error(`refused (${step.reason}): ${JSON.stringify(event)} from ${from.run.status}`)
  return step
}

describe('parseRunMachine — legal transitions', () => {
  it.each<[string, ParseRunState, ParseRunEvent, Partial<ParseRunStatus>]>([
    ['idle → starting on a start', idle, { type: 'start-requested' }, { status: 'starting' }],
    ['starting → running once the POST answers', starting, { type: 'start-accepted', runId: 3, kind: 'reparse' }, { status: 'running', runId: 3, kind: 'reparse' }],
    ['starting → idle when the POST fails', starting, { type: 'start-rejected' }, { status: 'idle' }],
    ['starting → running on our own run ticking first', starting, { type: 'progress', event: tick(3) }, { status: 'running', runId: 3 }],
    ['idle → running on a run started elsewhere', idle, { type: 'progress', event: tick(3) }, { status: 'running', runId: 3 }],
    ['running → canceling on Stop', running(), { type: 'cancel-requested' }, { status: 'canceling', runId: 3 }],
    ['canceling → running when the cancel is refused', canceling(), { type: 'cancel-rejected', runId: 3 }, { status: 'running', runId: 3 }],
    ['running → idle on its end', running(), { type: 'finished', event: finished(3) }, { status: 'idle' }],
    ['canceling → idle on its end', canceling(), { type: 'finished', event: finished(3, 'canceled') }, { status: 'idle' }],
    ['starting → idle on our run ending before the POST answered', starting, { type: 'finished', event: finished(3) }, { status: 'idle' }],
    ['idle → running from a snapshot', idle, { type: 'snapshot', generation: 5, active: { state: 'running', run_id: 3, kind: 'restore', done: 0, total: 0 } }, { status: 'running', runId: 3, kind: 'restore' }],
    ['running → idle from an idle snapshot', running(), { type: 'snapshot', generation: 5, active: { state: 'idle' } }, { status: 'idle' }],
  ])('%s', (_name, from, event, want) => {
    expect(moves(from, event).state.run).toMatchObject(want)
  })

  it('a tick of the held run updates its progress without bumping the generation', () => {
    const step = moves(running(), { type: 'progress', event: tick(3, 2) })
    expect(step.state.run).toMatchObject({ status: 'running', progress: { done: 2 } })
    expect(step.state.generation).toBe(5)
  })

  it('a run ending records it, so its id is never taken again', () => {
    const step = moves(running(), { type: 'finished', event: finished(3) })
    expect(step.state.finishedThrough).toBe(3)
    expect(step.effect).toEqual({ type: 'ended', runId: 3, finished: finished(3) })
  })

  it('a newer run ticking ends the held one whose end was lost', () => {
    const step = moves(running(3), { type: 'progress', event: tick(4) })
    expect(step.state.run).toMatchObject({ status: 'running', runId: 4 })
    expect(step.effect).toEqual({ type: 'ended', runId: 3, finished: null })
  })

  it('an idle snapshot over a held run reports the run ended without an event', () => {
    const step = moves(running(), { type: 'snapshot', generation: 5, active: { state: 'idle' } })
    expect(step.effect).toEqual({ type: 'ended', runId: 3, finished: null })
  })

  it('an idle snapshot while our start is pending leaves it pending', () => {
    expect(moves(starting, { type: 'snapshot', generation: 5, active: { state: 'idle' } }).state.run).toEqual({ status: 'starting' })
  })

  it('a store swap snapshot carries no progress', () => {
    const step = moves(idle, { type: 'snapshot', generation: 5, active: { state: 'running', run_id: 3, kind: 'maintenance', done: 0, total: 0 } })
    expect(step.state.run).toMatchObject({ progress: null })
  })
})

describe('parseRunMachine — refused transitions', () => {
  it.each<[string, ParseRunState, ParseRunEvent, 'stale' | 'illegal']>([
    ['a second start', starting, { type: 'start-requested' }, 'illegal'],
    ['a start while a run holds the slot', running(), { type: 'start-requested' }, 'illegal'],
    ['Stop with nothing running', idle, { type: 'cancel-requested' }, 'illegal'],
    ['Stop on a store swap', running(3, 'restore'), { type: 'cancel-requested' }, 'illegal'],
    ['Stop twice', canceling(), { type: 'cancel-requested' }, 'illegal'],
    ['a POST answer naming another run than the one ticking', running(3), { type: 'start-accepted', runId: 4, kind: 'parse' }, 'illegal'],
    ['a POST answer for a run already over', at({ status: 'idle' }, 3), { type: 'start-accepted', runId: 3, kind: 'parse' }, 'stale'],
    ['a tick of a run already over', at({ status: 'idle' }, 3), { type: 'progress', event: tick(3) }, 'stale'],
    ['an end replayed', at({ status: 'idle' }, 3), { type: 'finished', event: finished(3) }, 'stale'],
    ['an end of an older run than the one held', running(4), { type: 'finished', event: finished(3) }, 'stale'],
    ['a snapshot read before the last change', running(), { type: 'snapshot', generation: 4, active: { state: 'idle' } }, 'stale'],
    ['a snapshot naming a run already over', at({ status: 'idle' }, 3), { type: 'snapshot', generation: 5, active: { state: 'running', run_id: 3, kind: 'parse', done: 1, total: 4 } }, 'stale'],
    ['a refused cancel for a run no longer canceling', running(), { type: 'cancel-rejected', runId: 3 }, 'stale'],
  ])('%s', (_name, from, event, reason) => {
    const step = stepParseRun(from, event)
    expect(step).toEqual({ ok: false, state: from, reason })
  })
})

describe('parseRunMachine — initial state', () => {
  it('starts idle, having seen no run end', () => {
    expect(initialParseRunState).toEqual({ run: { status: 'idle' }, finishedThrough: 0, generation: 0 })
  })
})
