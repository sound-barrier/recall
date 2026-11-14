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

// ── The per-key machine ──────────────────────────────────────────────
// One write in flight per key and at most one waiting behind it. A newer
// edit REPLACES the waiting write (each run persists the whole draft), and
// never starts while an older one is on the wire — two PUTs for one key in
// flight at once could land in either order, and the server keeps the last.
//
// `seq` names a write. A settle for any write but the one in flight is
// refused, which is what keeps a write the key no longer owns (discarded,
// cancelled) from reporting for it.

export type SaveSlot =
  | { status: 'idle' }
  /** A write is waiting — on its debounce, or behind the one in flight. */
  | { status: 'queued'; seq: number }
  /** `seq` is on the wire; `next` is the newer write waiting for it, if any. */
  | { status: 'saving'; seq: number; next: number | null }
  | { status: 'saved'; seq: number }
  /** `seq` failed; its run is kept so the next flush retries it. */
  | { status: 'error'; seq: number }

export type SaveEvent =
  | { type: 'queue'; seq: number }
  | { type: 'start'; seq: number }
  | { type: 'settle'; seq: number; ok: boolean }

export type SaveStep = { ok: true; slot: SaveSlot } | { ok: false; reason: 'stale' | 'illegal' }

const STALE: SaveStep = { ok: false, reason: 'stale' }
const ILLEGAL: SaveStep = { ok: false, reason: 'illegal' }

function settleSaving(slot: Extract<SaveSlot, { status: 'saving' }>, seq: number, ok: boolean): SaveStep {
  if (seq !== slot.seq) return STALE
  // A newer write supersedes this one whatever happened to it: it carries
  // the whole draft, so it is the only one that still matters.
  if (slot.next !== null) return { ok: true, slot: { status: 'queued', seq: slot.next } }
  return { ok: true, slot: ok ? { status: 'saved', seq } : { status: 'error', seq } }
}

/** The one transition function for a key's save. */
function stepSave(slot: SaveSlot, event: SaveEvent): SaveStep {
  switch (event.type) {
    case 'queue':
      return slot.status === 'saving'
        ? { ok: true, slot: { ...slot, next: event.seq } }
        : { ok: true, slot: { status: 'queued', seq: event.seq } }
    case 'start':
      if (slot.status !== 'queued' && slot.status !== 'error') return ILLEGAL
      if (slot.seq !== event.seq) return STALE
      return { ok: true, slot: { status: 'saving', seq: event.seq, next: null } }
    case 'settle':
      return slot.status === 'saving' ? settleSaving(slot, event.seq, event.ok) : STALE
  }
}

// What the room's status line says for a slot.
function saveStateOf(slot: SaveSlot): CoachSaveState {
  return slot.status
}

// ── The queue ────────────────────────────────────────────────────────

// The run the slot's newest write will persist, and its debounce timer
// (null once the debounce has run out, or for a failed write kept for retry).
interface Waiting {
  seq: number
  run: () => Promise<void>
  timer: ReturnType<typeof setTimeout> | null
}

interface KeyEntry {
  waiting: Waiting | null
  inFlight: Promise<void> | null
}

export function useCoachAutosave() {
  const slots = ref<Record<string, SaveSlot>>({})
  const entries = new Map<string, KeyEntry>()
  let nextSeq = 0

  function slotOf(key: string): SaveSlot {
    return slots.value[key] ?? { status: 'idle' }
  }

  function dispatch(key: string, event: SaveEvent): boolean {
    const step = stepSave(slotOf(key), event)
    if (step.ok) slots.value = { ...slots.value, [key]: step.slot }
    return step.ok
  }

  /** Where the save for one key stands — 'idle' for a key never queued. */
  function saveStateFor(key: string): CoachSaveState {
    return saveStateOf(slotOf(key))
  }

  /** True while any key is still holding words the server never took. */
  const hasFailedSaves = computed(() =>
    Object.values(slots.value).some(slot => slot.status === 'error'))

  /**
   * True once a write for this key has gone out — the server may hold the
   * row even if the write has not answered yet. A delete has to queue behind
   * it rather than assume there is nothing to delete.
   */
  function hasStarted(key: string): boolean {
    const status = slotOf(key).status
    return status === 'saving' || status === 'saved' || status === 'error'
  }

  async function succeeded(run: () => Promise<void>): Promise<boolean> {
    // The reason is on the wire, not actionable here — the room's
    // role=status line is the whole report, and the draft is kept so
    // the coach's words survive a failed save.
    try {
      await run()
      return true
    } catch (_) {
      return false
    }
  }

  function clearTimer(waiting: Waiting): void {
    if (waiting.timer !== null) clearTimeout(waiting.timer)
    waiting.timer = null
  }

  // Send the waiting write if nothing is on the wire for its key.
  function startWaiting(key: string): void {
    const entry = entries.get(key)
    const waiting = entry?.waiting
    if (!entry || !waiting || entry.inFlight) return
    clearTimer(waiting)
    if (!dispatch(key, { type: 'start', seq: waiting.seq })) return
    entry.inFlight = (async () => {
      const ok = await succeeded(waiting.run)
      if (entries.get(key) !== entry) return
      entry.inFlight = null
      // Refused when the key was cancelled meanwhile: this answer reports
      // nothing — but a write queued since still has to go out.
      const settled = dispatch(key, { type: 'settle', seq: waiting.seq, ok })
      // A failed write stays waiting (timer-less) so the next flush retries
      // it; a landed one is done unless a newer edit replaced it meanwhile.
      if (settled && ok && entry.waiting === waiting) entry.waiting = null
      if (entry.waiting && entry.waiting !== waiting && entry.waiting.timer === null) startWaiting(key)
    })()
  }

  /** Debounce `run` under `key`, replacing whatever was waiting there. */
  function queueSave(key: string, run: () => Promise<void>): void {
    const entry = entries.get(key) ?? { waiting: null, inFlight: null }
    entries.set(key, entry)
    if (entry.waiting) clearTimer(entry.waiting)
    const seq = ++nextSeq
    const waiting: Waiting = { seq, run, timer: null }
    waiting.timer = setTimeout(() => { waiting.timer = null; startWaiting(key) }, AUTOSAVE_MS)
    entry.waiting = waiting
    dispatch(key, { type: 'queue', seq })
  }

  // Wait out the write in flight, then send what waits behind it — once:
  // a write that fails during the flush stays failed for the caller to see.
  async function flushKey(key: string): Promise<void> {
    const entry = entries.get(key)
    if (!entry) return
    const attempted = new Set<number>()
    while (entries.get(key) === entry) {
      if (entry.inFlight) {
        await entry.inFlight
        continue
      }
      const waiting = entry.waiting
      if (!waiting || attempted.has(waiting.seq)) return
      attempted.add(waiting.seq)
      startWaiting(key)
    }
  }

  // Run every queued save NOW, retries included — the export has to carry
  // what the coach just typed, not what settled 400 ms ago.
  async function flushSaves(): Promise<void> {
    await Promise.all([...entries.keys()].map(flushKey))
  }

  // Drop one key's waiting save without running it. The delete path needs
  // it: a row removed while its own PUT is still settling would otherwise be
  // written back a moment after the server was told to drop it. A write
  // already on the wire cannot be recalled; its answer reports nothing.
  function cancelSave(key: string): void {
    const entry = entries.get(key)
    if (!entry) return
    if (entry.waiting) clearTimer(entry.waiting)
    entry.waiting = null
    // A write still on the wire stays visible to flushSaves, so a delete
    // can wait for it to land rather than race it.
    if (!entry.inFlight) entries.delete(key)
    const { [key]: _dropped, ...rest } = slots.value
    slots.value = rest
  }

  // Throw the queue away, drafts and failures alike. Only legitimate when
  // the drafts themselves are going — a different player's notes have
  // replaced them.
  function discardSaves(): void {
    for (const entry of entries.values()) if (entry.waiting) clearTimer(entry.waiting)
    entries.clear()
    slots.value = {}
  }

  return { saveStateFor, hasFailedSaves, hasStarted, queueSave, cancelSave, flushSaves, discardSaves }
}
