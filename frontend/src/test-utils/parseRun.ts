import type { RunKind } from '@/api-client'
import type { ParseProgressEvent } from '@/components/ingest/parse-progress'

// Puts a parse store into a run state the way the app does — through the
// events and resync snapshot it reads — so a component test seeds the run
// without reaching past the store's public surface.

interface ParseRunDoor {
  onParseProgress: (event: ParseProgressEvent) => void
  applySnapshot: (active: {
    state: 'running' | 'canceling'
    run_id: number
    kind: RunKind
    done: number
    total: number
  }, generation: number) => void
  runGeneration: () => number
}

export interface SeedParseRun {
  state: 'running' | 'canceling'
  kind?: RunKind
  progress?: Omit<ParseProgressEvent, 'run_id'>
}

export const SEEDED_RUN_ID = 1

/** A progress tick of the seeded run. */
export function runTick(over: Partial<ParseProgressEvent> = {}): ParseProgressEvent {
  return { run_id: SEEDED_RUN_ID, done: 0, total: 0, filename: '', screenshot_type: '', ...over }
}

export function seedParseRun(store: ParseRunDoor, seed: SeedParseRun): void {
  store.applySnapshot({
    state: seed.state,
    run_id: SEEDED_RUN_ID,
    kind: seed.kind ?? 'parse',
    done: seed.progress?.done ?? 0,
    total: seed.progress?.total ?? 0,
  }, store.runGeneration())
  if (seed.progress) store.onParseProgress({ ...seed.progress, run_id: SEEDED_RUN_ID })
}
