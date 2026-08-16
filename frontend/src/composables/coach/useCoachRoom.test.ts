import { describe, it, expect } from 'vitest'
import { ref } from 'vue'

import type { MatchRecord, MatchResult } from '@/api-client'
import { useCoachRoom } from '@/composables/coach/useCoachRoom'
import { emptyDraft, type CoachNoteDraft } from '@/match/coach-notes'

function rec(key: string, data: MatchResult, hidden = false): MatchRecord {
  return { match_key: key, source_files: [`${key}.png`], data, hidden }
}

// Two of the player's days, newest last in the input so the grouping
// (not the array order) is what puts the reel in order.
const OLDEST = rec('match-2026-08-07T20-05-00', { date: '2026-08-07', finished_at: '20:05', result: 'victory', map: 'busan', hero: 'juno' })
const EARLY = rec('match-2026-08-08T21-14-00', { date: '2026-08-08', finished_at: '21:14', result: 'victory', map: "king's row", hero: 'ana' })
const LATE = rec('match-2026-08-08T22-30-00', { date: '2026-08-08', finished_at: '22:30', result: 'defeat', map: 'numbani', hero: 'kiriko' })
const HIDDEN = rec('match-2026-08-08T23-00-00', { date: '2026-08-08', finished_at: '23:00', result: 'victory', map: 'oasis', hero: 'lucio' }, true)

const RECORDS = [OLDEST, EARLY, LATE, HIDDEN]

function room(selectedKey = '', notes: Record<string, CoachNoteDraft> = {}) {
  return useCoachRoom({ records: RECORDS, notes, selectedKey: ref(selectedKey) })
}

describe('useCoachRoom — the reel', () => {
  it("groups the player's days newest first and drops hidden matches", () => {
    const { reelDays } = room()
    expect(reelDays.value.map((d) => d.dayKey)).toEqual(['2026-08-08', '2026-08-07'])
    expect(reelDays.value[0]?.frames.map((f) => f.match_key)).toEqual([LATE.match_key, EARLY.match_key])
    expect(reelDays.value[0]?.played).toBe(2)
  })

  it('flattens the reel into the order prev/next walks', () => {
    const { frames } = room()
    expect(frames.value.map((f) => f.match_key)).toEqual([LATE.match_key, EARLY.match_key, OLDEST.match_key])
  })
})

describe('useCoachRoom — the selection', () => {
  it('falls back to the first frame when nothing is selected', () => {
    const { activeKey, selectedRecord } = room()
    expect(activeKey.value).toBe(LATE.match_key)
    expect(selectedRecord.value?.match_key).toBe(LATE.match_key)
  })

  it('falls back to the first frame when the selected key is not on the reel', () => {
    const { activeKey } = room('match-not-here')
    expect(activeKey.value).toBe(LATE.match_key)
  })

  it('has no record at all when the reel is empty', () => {
    const { activeKey, selectedRecord, prevKey, nextKey } = useCoachRoom({ records: [], notes: {}, selectedKey: '' })
    expect(activeKey.value).toBe('')
    expect(selectedRecord.value).toBeNull()
    expect(prevKey.value).toBeNull()
    expect(nextKey.value).toBeNull()
  })

  it('steps prev/next through the flattened reel and stops at the ends', () => {
    expect(room(LATE.match_key).prevKey.value).toBeNull()
    expect(room(LATE.match_key).nextKey.value).toBe(EARLY.match_key)
    expect(room(EARLY.match_key).prevKey.value).toBe(LATE.match_key)
    expect(room(OLDEST.match_key).nextKey.value).toBeNull()
  })

  it('tracks a selection that changes', () => {
    const selectedKey = ref(LATE.match_key)
    const { activeKey, nextKey } = useCoachRoom({ records: RECORDS, notes: {}, selectedKey })
    selectedKey.value = OLDEST.match_key
    expect(activeKey.value).toBe(OLDEST.match_key)
    expect(nextKey.value).toBeNull()
  })
})

describe('useCoachRoom — the session tallies', () => {
  it('tallies W/L/D and the win rate over the visible frames', () => {
    const { wld, winRate } = room()
    expect(wld.value).toEqual({ w: 2, l: 1, d: 0 })
    expect(winRate.value).toBe(67)
  })

  it('reports no win rate when nothing was decisive', () => {
    const draws = [rec('match-2026-08-08T10-00-00', { date: '2026-08-08', result: 'draw' })]
    const { winRate } = useCoachRoom({ records: draws, notes: {}, selectedKey: '' })
    expect(winRate.value).toBeNull()
  })

  it("counts the coach's focus tags across every note, most-used first", () => {
    const notes: Record<string, CoachNoteDraft> = {
      [LATE.match_key]: { ...emptyDraft(), text: 'peel', focusTags: ['positioning', 'cooldowns'] },
      [EARLY.match_key]: { ...emptyDraft(), text: 'ult', focusTags: ['positioning'], extraTags: ['tempo'] },
    }
    const { focusTally } = room('', notes)
    expect(focusTally.value).toEqual([
      { tag: 'positioning', count: 2 },
      { tag: 'cooldowns', count: 1 },
      { tag: 'tempo', count: 1 },
    ])
  })

  it('hands the editor an empty draft for a frame with no note', () => {
    const notes = { [EARLY.match_key]: { ...emptyDraft(), text: 'written' } }
    expect(room(LATE.match_key, notes).activeDraft.value).toEqual(emptyDraft())
    expect(room(EARLY.match_key, notes).activeDraft.value.text).toBe('written')
  })
})
