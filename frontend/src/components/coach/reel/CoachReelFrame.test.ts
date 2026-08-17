import { render, screen, fireEvent } from '@testing-library/vue'
import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api-client'
import CoachReelFrame from '@/components/coach/reel/CoachReelFrame.vue'
import { emptyDraft } from '@/match/coach/coach-notes'

const KINGS_ROW: MatchRecord = {
  match_key: 'match-2026-08-08T21-14-00',
  source_files: ['match-2026-08-08T21-14-00.png'],
  data: {
    map: "king's row", game_mode: 'hybrid', hero: 'ana', result: 'victory',
    date: '2026-08-08', finished_at: '21:14',
    // 9 h off the naive clock: a frame that read the canonical instant
    // in the coach's zone would show a different hour.
    played_at_utc: '2026-08-09T06:14:00Z',
  },
}

const NOTED: MatchRecord = {
  ...KINGS_ROW,
  annotation: { leavers: [], throwers: [], note: 'Peeled too late on point B.' },
}

describe('CoachReelFrame', () => {
  it("names the frame by map, the player's clock, hero and result", () => {
    render(CoachReelFrame, { props: { record: KINGS_ROW } })
    expect(screen.getByRole('button', { name: "King's Row · 21:14 · Ana · Victory" })).toBeInTheDocument()
  })

  it("prints the map so the frame reads without its label", () => {
    render(CoachReelFrame, { props: { record: KINGS_ROW } })
    expect(screen.getByText("King's Row")).toBeInTheDocument()
    expect(screen.getByText('21:14')).toBeInTheDocument()
  })

  it('takes canonical display names from the labels prop when it has them', () => {
    render(CoachReelFrame, {
      props: { record: KINGS_ROW, labels: { map: () => 'Kings Row (canonical)', hero: () => 'Ana Amari' } },
    })
    expect(screen.getByRole('button', { name: /Kings Row \(canonical\) · 21:14 · Ana Amari/ })).toBeInTheDocument()
  })

  it('says a note was written in the frame name', () => {
    const draft = { ...emptyDraft(), text: 'Hold high ground.' }
    render(CoachReelFrame, { props: { record: KINGS_ROW, draft } })
    expect(screen.getByRole('button', { name: /— note written$/ })).toBeInTheDocument()
  })

  it('says a frame was marked reviewed with nothing to add', () => {
    const draft = { ...emptyDraft(), kind: 'reviewed_only' as const }
    render(CoachReelFrame, { props: { record: KINGS_ROW, draft } })
    expect(screen.getByRole('button', { name: /— reviewed$/ })).toBeInTheDocument()
  })

  it('carries no suffix for a draft that says nothing yet', () => {
    render(CoachReelFrame, { props: { record: KINGS_ROW, draft: { ...emptyDraft(), matchClock: '04:12' } } })
    expect(screen.getByRole('button', { name: /Victory$/ })).toBeInTheDocument()
  })

  it('marks the selected frame with aria-current', () => {
    render(CoachReelFrame, { props: { record: KINGS_ROW, selected: true } })
    expect(screen.getByRole('button')).toHaveAttribute('aria-current', 'true')
  })

  it('leaves aria-current off every other frame', () => {
    render(CoachReelFrame, { props: { record: KINGS_ROW } })
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-current')
  })

  it('emits its match key when picked', async () => {
    const view = render(CoachReelFrame, { props: { record: KINGS_ROW } })
    await fireEvent.click(screen.getByRole('button'))
    expect(view.emitted('select')).toEqual([[KINGS_ROW.match_key]])
  })

  it("quotes the player's own note on the frame she wrote it on", () => {
    render(CoachReelFrame, { props: { record: NOTED } })
    expect(screen.getByText(/Peeled too late on point B/)).toBeInTheDocument()
  })

  it('falls back to the unknown-map label and the capture clock', () => {
    const unknown: MatchRecord = {
      match_key: 'match-2026-08-08T19-02-11',
      source_files: [],
      data: { map_raw: 'nubani', hero: 'juno', result: 'defeat' },
    }
    render(CoachReelFrame, { props: { record: unknown } })
    expect(screen.getByRole('button', { name: 'Unknown map (nubani?) · 19:02 · Juno · Defeat' })).toBeInTheDocument()
  })
})
