import { render, screen } from '@testing-library/vue'
import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api-client'
import CoachMatchCard from '@/components/coach/room/CoachMatchCard.vue'

const KINGS_ROW: MatchRecord = {
  match_key: 'match-2026-08-08T21-14-00',
  source_files: ['match-2026-08-08T21-14-00.png'],
  queue_type: 'role',
  play_mode: 'competitive',
  data: {
    map: "king's row", game_mode: 'hybrid', hero: 'ana', role: 'support',
    result: 'victory', final_score: '3-2',
    eliminations: 14, assists: 21, deaths: 4, healing: 9840,
    date: '2026-08-08', finished_at: '21:14',
    // The canonical instant is 9 h from the naive clock — a card that
    // rendered it in the coach's zone would print a different time.
    played_at_utc: '2026-08-09T06:14:00Z',
    heroes_played: [{ hero: 'ana', percent_played: 100, play_time: '11:40' }],
  },
  annotation: {
    leavers: [], throwers: [],
    note: 'Kept peeling too late for the tank on point B.',
    tags: ['stack'],
    replay_code: 'A1B2C3',
  },
}

function renderCard(record: MatchRecord = KINGS_ROW) {
  return render(CoachMatchCard, { props: { record, handle: 'Sable' } })
}

describe('CoachMatchCard', () => {
  it('is one article headed by the map', () => {
    renderCard()
    const desk = screen.getByRole('article')
    expect(desk).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: "King's Row" })).toBeInTheDocument()
  })

  it("labels when the match was played as the player's clock", () => {
    renderCard()
    expect(screen.getByText("When · Sable's clock")).toBeInTheDocument()
    expect(screen.getByText('Sat · Aug 8 · 21:14')).toBeInTheDocument()
  })

  it('shows the game mode, queue and play mode — this data carries no submap', () => {
    renderCard()
    expect(screen.getByText('hybrid')).toBeInTheDocument()
    expect(screen.getByText('Role Queue')).toBeInTheDocument()
    expect(screen.getByText('Competitive')).toBeInTheDocument()
  })

  it('shows the result with its score', () => {
    renderCard()
    expect(screen.getByText('Victory')).toBeInTheDocument()
    expect(screen.getByText('3-2')).toBeInTheDocument()
  })

  it('shows eliminations, assists, deaths and healing', () => {
    renderCard()
    expect(screen.getByText('Elims')).toBeInTheDocument()
    expect(screen.getByText('14')).toBeInTheDocument()
    expect(screen.getByText('21')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('9,840')).toBeInTheDocument()
  })

  it('splits the match across the heroes played', () => {
    renderCard()
    expect(screen.getByRole('progressbar', { name: 'ana share' })).toHaveAttribute('aria-valuenow', '100')
  })

  it("quotes the player's own note and shows her tags and replay code", () => {
    const view = renderCard()
    // Her words are a real quotation: the e2e reads this by
    // role=blockquote, which the unit runner's aria-query build has no
    // mapping for — so the element type is pinned here directly.
    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container -- see above
    expect(view.container.querySelector('blockquote')).toHaveTextContent(/Kept peeling too late/)
    expect(screen.getByText('stack')).toBeInTheDocument()
    expect(screen.getByText('A1B2C3')).toBeInTheDocument()
  })

  it('reuses the rank block for a match that carried a rank screen', () => {
    renderCard({ ...KINGS_ROW, data: { ...KINGS_ROW.data, rank: 'diamond', level: 3, rank_progress: 62, modifiers: ['expected'] } })
    expect(screen.getByText('Rank Update')).toBeInTheDocument()
    expect(screen.getByText('diamond 3')).toBeInTheDocument()
  })

  it('leaves the rank block out of an ordinary match', () => {
    renderCard()
    expect(screen.queryByText('Rank Update')).not.toBeInTheDocument()
  })

  it('shows the modifiers a match without a rank screen still carries', () => {
    renderCard({ ...KINGS_ROW, data: { ...KINGS_ROW.data, modifiers: ['uphill battle'] } })
    expect(screen.getByText('uphill battle')).toBeInTheDocument()
  })

  it('reads an undated match without inventing a clock', () => {
    renderCard({ match_key: 'unmatched-shot.png', source_files: [], data: { map: 'oasis', result: 'draw' } })
    expect(screen.getByText('Not dated')).toBeInTheDocument()
  })
})
