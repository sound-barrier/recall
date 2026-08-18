import { computed, ref } from 'vue'

import type { CoachSaveState } from '@/components/coach/room/coach-room-props'

// A debounced, per-key save queue: hand it a key and the work that persists
// that key, and it settles a burst of typing into one write and reports where
// that write stands.
//
// Save state is PER KEY. One global flag let a successful save on any other
// key erase the only evidence that this one never landed, and the coach's
// export then found an empty queue and cleared the "not exported" warning on
// an archive that was missing the note.
//
// The queue is a pure mechanism — it knows nothing about sessions, notes or
// players. Whoever owns those decides what a key means and what a run does.

/** How long a burst of typing settles before the draft is saved. */
export const AUTOSAVE_MS = 400

// One queued autosave. `timer` is null once the run is in flight or has
// failed — a failed run stays in the map so the next flush retries it.
interface PendingSave {
  timer: ReturnType<typeof setTimeout> | null
  run:   () => Promise<void>
}

export function useCoachAutosave() {
  const saveStates = ref<Record<string, CoachSaveState>>({})
  const pendingSaves = new Map<string, PendingSave>()

  function setSaveState(key: string, state: CoachSaveState): void {
    saveStates.value = { ...saveStates.value, [key]: state }
  }

  /** Where the save for one key stands — 'idle' for a key never queued. */
  function saveStateFor(key: string): CoachSaveState {
    return saveStates.value[key] ?? 'idle'
  }

  /** True while any key is still holding words the server never took. */
  const hasFailedSaves = computed(() =>
    Object.values(saveStates.value).some(state => state === 'error'))

  async function failed(run: () => Promise<void>): Promise<boolean> {
    // The reason is on the wire, not actionable here — the room's
    // role=status line is the whole report, and the draft is kept so
    // the coach's words survive a failed save.
    try {
      await run()
      return false
    } catch (_) {
      return true
    }
  }

  // A failed run stays in the map, so the next flush retries it. Dropping it
  // is how a note leaves with an export that never carried it.
  async function runSave(key: string): Promise<void> {
    const queued = pendingSaves.get(key)
    if (!queued) return
    clearQueuedTimer(queued)
    setSaveState(key, 'saving')
    const broke = await failed(queued.run)
    // A newer edit may have claimed the key while this one was in flight;
    // its own run reports for it.
    if (pendingSaves.get(key) !== queued) return
    if (broke) {
      setSaveState(key, 'error')
      return
    }
    pendingSaves.delete(key)
    setSaveState(key, 'saved')
  }

  function clearQueuedTimer(queued: PendingSave): void {
    if (queued.timer !== null) clearTimeout(queued.timer)
    queued.timer = null
  }

  /** Debounce `run` under `key`, replacing whatever was queued there. */
  function queueSave(key: string, run: () => Promise<void>): void {
    const previous = pendingSaves.get(key)
    if (previous) clearQueuedTimer(previous)
    pendingSaves.set(key, { timer: setTimeout(() => { void runSave(key) }, AUTOSAVE_MS), run })
  }

  // Run every queued save NOW, retries included — the export has to carry
  // what the coach just typed, not what settled 400 ms ago.
  async function flushSaves(): Promise<void> {
    await Promise.all([...pendingSaves.keys()].map(runSave))
  }

  // Drop one key's queued save without running it. The delete path needs it:
  // a row removed while its own PUT is still settling would otherwise be
  // written back a moment after the server was told to drop it.
  function cancelSave(key: string): void {
    const queued = pendingSaves.get(key)
    if (!queued) return
    clearQueuedTimer(queued)
    pendingSaves.delete(key)
    setSaveState(key, 'idle')
  }

  // Throw the queue away, drafts and failures alike. Only legitimate when
  // the drafts themselves are going — a different player's notes have
  // replaced them.
  function discardSaves(): void {
    for (const queued of pendingSaves.values()) clearQueuedTimer(queued)
    pendingSaves.clear()
    saveStates.value = {}
  }

  return { saveStateFor, hasFailedSaves, queueSave, cancelSave, flushSaves, discardSaves }
}
