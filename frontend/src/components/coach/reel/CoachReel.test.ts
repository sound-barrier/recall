import { render, screen, fireEvent } from '@testing-library/vue'
import { describe, it, expect } from 'vitest'

import type { MatchRecord, MatchResult } from '@/api-client'
import CoachReel from '@/components/coach/reel/CoachReel.vue'
import { emptyDraft } from '@/match/coach/coach-notes'
import { groupReelByPlayerDay } from '@/match/coach/coach-reel-helpers'

function rec(key: string, data: MatchResult): MatchRecord {
  return { match_key: key, source_files: [], data }
}

const LATE = rec('match-2026-08-08T22-30-00', { date: '2026-08-08', finished_at: '22:30', result: 'defeat', map: 'numbani', hero: 'kiriko' })
const EARLY = rec('match-2026-08-08T21-14-00', { date: '2026-08-08', finished_at: '21:14', result: 'victory', map: "king's row", hero: 'ana' })
const OLDER = rec('match-2026-08-07T20-05-00', { date: '2026-08-07', finished_at: '20:05', result: 'victory', map: 'busan', hero: 'juno' })

const DAYS = groupReelByPlayerDay([OLDER, EARLY, LATE])

function renderReel(props: Record<string, unknown> = {}) {
  return render(CoachReel, {
    props: { handle: 'Sable', days: DAYS, selectedKey: '', notes: {}, ...props },
  })
}

describe('CoachReel', () => {
  it("is a list named for the player, saying whose clock the times are in", () => {
    renderReel()
    expect(screen.getByRole('list', { name: "Sable's matches — times in Sable's clock" })).toBeInTheDocument()
  })

  it('labels the clock once, visibly, so the reel reads without a screen reader', () => {
    renderReel()
    expect(screen.getAllByText(/Sable.s clock/)).toHaveLength(1)
  })

  it("heads each of the player's days with its tally", () => {
    renderReel()
    expect(screen.getByRole('heading', { level: 3, name: 'Sat · Aug 8 · 2 played · 1–1' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Fri · Aug 7 · 1 played · 1–0' })).toBeInTheDocument()
  })

  it('holds one button per frame, newest first', () => {
    renderReel()
    const frames = screen.getAllByRole('button')
    expect(frames).toHaveLength(3)
    expect(frames.map((f) => f.getAttribute('aria-label'))).toEqual([
      'Numbani · 22:30 · Kiriko · Defeat',
      "King's Row · 21:14 · Ana · Victory",
      'Busan · 20:05 · Juno · Victory',
    ])
  })

  it('relays the frame the coach picked', async () => {
    const view = renderReel()
    await fireEvent.click(screen.getByRole('button', { name: /King's Row/ }))
    expect(view.emitted('select')).toEqual([[EARLY.match_key]])
  })

  it('marks the frame on the desk with aria-current', () => {
    renderReel({ selectedKey: EARLY.match_key })
    expect(screen.getByRole('button', { name: /King's Row/ })).toHaveAttribute('aria-current', 'true')
  })

  it("hands each frame the coach's draft for that match", () => {
    renderReel({ notes: { [OLDER.match_key]: { ...emptyDraft(), kind: 'reviewed_only' as const } } })
    expect(screen.getByRole('button', { name: /Busan .* — reviewed$/ })).toBeInTheDocument()
  })
})
