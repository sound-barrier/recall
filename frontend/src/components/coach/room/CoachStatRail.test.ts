import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/vue'

import CoachStatRail from '@/components/coach/room/CoachStatRail.vue'
import type { RailTendency } from '@/match/coach/coach-rail-helpers'

function row(over: Partial<RailTendency> = {}): RailTendency {
  return {
    key: 'ana',
    dimension: 'hero',
    played: 6,
    w: 4,
    l: 2,
    winrate: 67,
    elims: 18.5,
    assists: 9,
    deaths: 5.5,
    statSample: 6,
    lowSample: false,
    ...over,
  }
}

const rail = () => screen.getByRole('region', { name: 'Player tendencies' })

// The rail is reference a coach reads mid-frame. Every one of these branches
// is a case where the honest answer differs from the confident one.
describe('CoachStatRail', () => {
  // Two rows, one per dimension — and each falls back to the STORED name
  // when the roster has not loaded, which is the state a freshly-opened
  // room is in. A blank heading there would be worse than a lowercase one.
  it('names the dimension it is talking about, hero or map', () => {
    render(CoachStatRail, { props: { rows: [row(), row({ key: "king's row", dimension: 'map' })] } })
    expect(rail()).toHaveTextContent('On ana')
    expect(rail()).toHaveTextContent("On king's row")
  })

  it('puts the rate in ARIA so it is not color alone', () => {
    render(CoachStatRail, { props: { rows: [row()] } })
    expect(screen.getByRole('progressbar', { name: 'ana winrate' }))
      .toHaveAttribute('aria-valuenow', '67')
  })

  // A bundle is six matches, so a bucket of two is the norm — presenting it
  // as a tendency is the rail's most likely lie.
  it('says when a bucket is too small to read', () => {
    render(CoachStatRail, { props: { rows: [row({ w: 2, l: 0, winrate: 100, lowSample: true })] } })
    expect(rail()).toHaveTextContent(/too few to read/i)
  })

  // A draw is not a loss, so an all-draws bucket has no rate. 0% would read
  // as "you lost every game" — and there must be no bar to misread either.
  it('reports no rate at all when nothing was decided', () => {
    render(CoachStatRail, { props: { rows: [row({ w: 0, l: 0, winrate: null })] } })
    expect(rail()).toHaveTextContent('—')
    expect(rail()).toHaveTextContent(/nothing decided yet/i)
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  // A screenshot Recall could not read is not a game with no eliminations.
  it('says there are no stat readings rather than printing zeros', () => {
    render(CoachStatRail, {
      props: { rows: [row({ elims: null, assists: null, deaths: null, statSample: 0 })] },
    })
    expect(rail()).toHaveTextContent(/no stat readings/i)
    expect(rail()).not.toHaveTextContent(/0 E/)
  })

  it('prints the E·A·D shape when it has one', () => {
    render(CoachStatRail, { props: { rows: [row()] } })
    expect(rail()).toHaveTextContent('18.5 E · 9 A · 5.5 D')
  })
})
