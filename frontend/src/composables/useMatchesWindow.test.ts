import { describe, it, expect } from 'vitest'
import { nextTick, ref } from 'vue'
import type { MatchRecord } from '../api'
import { useMatchesWindow, DEFAULT_PAGE_SIZE } from './useMatchesWindow'

function makeRecords(n: number): MatchRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    match_key: `m${i}`,
    source_files: [`m${i}.png`],
    source_types: { [`m${i}.png`]: 'summary' },
    data: { date: '2026-05-10', map: 'rialto' },
    parsed_at: `2026-05-10T00:00:0${i % 10}Z`,
  } as unknown as MatchRecord))
}

describe('useMatchesWindow', () => {
  it('starts at exactly pageSize on first read', () => {
    const records = ref(makeRecords(50))
    const { renderedCount } = useMatchesWindow(records, [], ref(-1))
    expect(renderedCount.value).toBe(DEFAULT_PAGE_SIZE)
  })

  it('hasMore is true while corpus exceeds the window', () => {
    const records = ref(makeRecords(50))
    const { hasMore, renderedCount, bumpWindow } = useMatchesWindow(records, [], ref(-1))
    expect(hasMore.value).toBe(true)
    bumpWindow()
    expect(renderedCount.value).toBe(40)
    expect(hasMore.value).toBe(true)
    bumpWindow()
    // 60 would overshoot 50, so the clamp pulls it back to corpus size.
    expect(renderedCount.value).toBe(50)
    expect(hasMore.value).toBe(false)
  })

  it('hasMore is false from the start when corpus fits in one page', () => {
    const records = ref(makeRecords(5))
    const { hasMore, renderedCount } = useMatchesWindow(records, [], ref(-1))
    expect(renderedCount.value).toBe(DEFAULT_PAGE_SIZE) // still 20, the floor
    expect(hasMore.value).toBe(false)
  })

  it('bumpWindow no-ops once the corpus is fully rendered', () => {
    const records = ref(makeRecords(15))
    const { renderedCount, bumpWindow } = useMatchesWindow(records, [], ref(-1))
    bumpWindow()
    expect(renderedCount.value).toBe(15)
    bumpWindow()
    expect(renderedCount.value).toBe(15)
  })

  it('expandWindowToAll jumps renderedCount to the corpus length in one step', () => {
    const records = ref(makeRecords(500))
    const { renderedCount, hasMore, expandWindowToAll } = useMatchesWindow(records, [], ref(-1))
    expect(renderedCount.value).toBe(DEFAULT_PAGE_SIZE)
    expect(hasMore.value).toBe(true)
    expandWindowToAll()
    expect(renderedCount.value).toBe(500)
    expect(hasMore.value).toBe(false)
  })

  it('expandWindowToAll is a no-op on an empty corpus (does not throw)', () => {
    const records = ref(makeRecords(0))
    const { renderedCount, expandWindowToAll } = useMatchesWindow(records, [], ref(-1))
    expandWindowToAll()
    expect(renderedCount.value).toBe(0)
  })

  it('reset() snaps back to pageSize and bumps resetCounter', () => {
    const records = ref(makeRecords(50))
    const { renderedCount, bumpWindow, reset, resetCounter } = useMatchesWindow(records, [], ref(-1))
    bumpWindow()
    expect(renderedCount.value).toBe(40)
    expect(resetCounter.value).toBe(0)
    reset()
    expect(renderedCount.value).toBe(DEFAULT_PAGE_SIZE)
    expect(resetCounter.value).toBe(1)
  })

  it('narrowedRecords mutation triggers reset', async () => {
    const records = ref(makeRecords(50))
    const { renderedCount, bumpWindow, resetCounter } = useMatchesWindow(records, [], ref(-1))
    bumpWindow()
    expect(renderedCount.value).toBe(40)
    records.value = makeRecords(30)
    await nextTick()
    expect(renderedCount.value).toBe(DEFAULT_PAGE_SIZE)
    expect(resetCounter.value).toBe(1)
  })

  it('extra reset triggers also fire reset (sort/group surrogates)', async () => {
    const records = ref(makeRecords(50))
    const sortOrder = ref<'newest' | 'oldest'>('newest')
    const groupBy = ref<'none' | 'day'>('day')
    const { renderedCount, bumpWindow, resetCounter } = useMatchesWindow(
      records,
      [sortOrder, groupBy],
      ref(-1),
    )
    bumpWindow()
    expect(renderedCount.value).toBe(40)
    sortOrder.value = 'oldest'
    await nextTick()
    expect(renderedCount.value).toBe(DEFAULT_PAGE_SIZE)
    expect(resetCounter.value).toBe(1)
    groupBy.value = 'none'
    await nextTick()
    expect(resetCounter.value).toBe(2)
  })

  it('ensureIndexVisible expands the window until the index is in range', async () => {
    const records = ref(makeRecords(100))
    const focused = ref(-1)
    const { renderedCount, ensureIndexVisible } = useMatchesWindow(records, [], focused)
    expect(renderedCount.value).toBe(20)
    // Direct call covers the imperative path used by App.vue's
    // keyboard handler; the reactive-watcher path lands two
    // assertions below.
    ensureIndexVisible(55)
    // Whole-page expansion — 60 (3 * pageSize) is the first
    // multiple > 55.
    expect(renderedCount.value).toBe(60)
  })

  it('focused-index watcher expands reactively (post-nextTick)', async () => {
    const records = ref(makeRecords(100))
    const focused = ref(-1)
    const { renderedCount } = useMatchesWindow(records, [], focused)
    focused.value = 42
    await nextTick()
    expect(renderedCount.value).toBe(60)
  })

  it('ensureIndexVisible ignores negative focus index', async () => {
    const records = ref(makeRecords(50))
    const focused = ref(10)
    const { renderedCount } = useMatchesWindow(records, [], focused)
    focused.value = -1
    await nextTick()
    expect(renderedCount.value).toBe(20)
  })

  it('respects a non-default pageSize', () => {
    const records = ref(makeRecords(100))
    const { renderedCount, bumpWindow } = useMatchesWindow(records, [], ref(-1), 5)
    expect(renderedCount.value).toBe(5)
    bumpWindow()
    expect(renderedCount.value).toBe(10)
  })
})
