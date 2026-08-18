import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AUTOSAVE_MS, useCoachAutosave } from '@/composables/coach/useCoachAutosave'

// The per-key save queue on its own, with no session, no store and no
// server. Everything below is about words the coach has already typed:
// the queue's whole job is that a draft either lands or is still visibly
// trying, and never quietly stops being either.

/** A run that hangs until the test releases it, so "in flight" is a state. */
function heldRun(): { run: () => Promise<void>; settle: () => void; fail: () => void } {
  let settle = () => {}
  let fail = () => {}
  const run = () => new Promise<void>((resolve, reject) => {
    settle = resolve
    // The queue catches every rejection, so this never escapes as unhandled.
    fail = () => { reject(new Error('the server refused it')) }
  })
  return { run, settle: () => { settle() }, fail: () => { fail() } }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('useCoachAutosave', () => {
  it('keeps a failed save queued, so the next flush retries it with no new edit', async () => {
    const auto = useCoachAutosave()
    const run = vi.fn()
      .mockRejectedValueOnce(new Error('the server refused it'))
      .mockResolvedValueOnce(undefined)

    auto.queueSave('note', run)
    await auto.flushSaves()
    expect(run).toHaveBeenCalledTimes(1)
    expect(auto.saveStateFor('note')).toBe('error')
    expect(auto.hasFailedSaves.value).toBe(true)

    // Nothing is re-queued in between: the retry has to come from the queue
    // itself, because the coach types nothing more before hitting Export.
    await auto.flushSaves()

    expect(run).toHaveBeenCalledTimes(2)
    expect(auto.saveStateFor('note')).toBe('saved')
    expect(auto.hasFailedSaves.value).toBe(false)
  })

  it('lets a newer edit win over the save still in flight for that key', async () => {
    const auto = useCoachAutosave()
    const first = heldRun()
    const firstRun = vi.fn(first.run)
    const secondRun = vi.fn(async () => {})

    auto.queueSave('note', firstRun)
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)
    expect(firstRun).toHaveBeenCalledTimes(1)
    expect(auto.saveStateFor('note')).toBe('saving')

    // The coach keeps typing while the first PUT is still on the wire.
    auto.queueSave('note', secondRun)
    first.settle()
    await vi.advanceTimersByTimeAsync(0)

    // The superseded run must not report for a key it no longer owns —
    // saying 'saved' here would credit the OLD text and drop the new one.
    expect(auto.saveStateFor('note')).toBe('saving')

    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)
    expect(secondRun).toHaveBeenCalledTimes(1)
    expect(auto.saveStateFor('note')).toBe('saved')
  })

  it('survives a discard that lands mid-flush — the abandoned run reports nothing', async () => {
    const auto = useCoachAutosave()
    const held = heldRun()

    auto.queueSave('note', held.run)
    const flushing = auto.flushSaves()
    expect(auto.saveStateFor('note')).toBe('saving')

    // A different player's notes replaced the drafts while the flush ran.
    auto.discardSaves()
    expect(auto.saveStateFor('note')).toBe('idle')

    held.fail()
    await flushing
    await vi.advanceTimersByTimeAsync(0)

    // An 'error' written back here would be unfixable: the queue is empty,
    // so no flush could ever clear it, and Export stays refused forever
    // over a draft that no longer exists.
    expect(auto.saveStateFor('note')).toBe('idle')
    expect(auto.hasFailedSaves.value).toBe(false)
  })

  it('debounces a burst into one run per key and keeps the keys apart', async () => {
    const auto = useCoachAutosave()
    const noteRun = vi.fn(async () => {})
    const summaryRun = vi.fn(async () => {})

    auto.queueSave('note', vi.fn(async () => {}))
    auto.queueSave('note', noteRun)
    auto.queueSave('summary', summaryRun)
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)

    expect(noteRun).toHaveBeenCalledTimes(1)
    expect(summaryRun).toHaveBeenCalledTimes(1)
    expect(auto.saveStateFor('note')).toBe('saved')
    expect(auto.saveStateFor('summary')).toBe('saved')
  })
})

describe('cancelSave', () => {
  it('drops a queued save so it never runs', async () => {
    const { queueSave, cancelSave, saveStateFor } = useCoachAutosave()
    const run = vi.fn().mockResolvedValue(undefined)

    queueSave('m1', run)
    cancelSave('m1')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 2)

    expect(run).not.toHaveBeenCalled()
    expect(saveStateFor('m1')).toBe('idle')
  })

  it('leaves every other key alone', async () => {
    const { queueSave, cancelSave } = useCoachAutosave()
    const kept = vi.fn().mockResolvedValue(undefined)

    queueSave('m1', vi.fn().mockResolvedValue(undefined))
    queueSave('m2', kept)
    cancelSave('m1')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 2)

    expect(kept).toHaveBeenCalledTimes(1)
  })

  // A key that failed stays in the queue so the next flush retries it —
  // cancelling must clear that too, or a discarded row is written back by
  // whatever flushes next.
  it('clears a failed save rather than leaving it for the next flush', async () => {
    const { queueSave, cancelSave, flushSaves, hasFailedSaves } = useCoachAutosave()
    const run = vi.fn().mockRejectedValue(new Error('refused'))

    queueSave('m1', run)
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 2)
    expect(hasFailedSaves.value).toBe(true)

    cancelSave('m1')
    await flushSaves()

    expect(run).toHaveBeenCalledTimes(1)
    expect(hasFailedSaves.value).toBe(false)
  })
})
