import { render, screen } from '@testing-library/vue'
import { describe, it, expect } from 'vitest'

import type { HeroPlay } from '@/api-client'
import CoachHeroSplit from '@/components/coach/CoachHeroSplit.vue'

const HEROES: HeroPlay[] = [
  { hero: 'ana', percent_played: 62, play_time: '07:14' },
  { hero: 'kiriko', percent_played: 38, play_time: '04:26' },
]

describe('CoachHeroSplit', () => {
  it('meters each hero with its share in ARIA, on the fill', () => {
    render(CoachHeroSplit, { props: { heroes: HEROES } })
    expect(screen.getByRole('progressbar', { name: 'ana share' })).toHaveAttribute('aria-valuenow', '62')
    expect(screen.getByRole('progressbar', { name: 'kiriko share' })).toHaveAttribute('aria-valuenow', '38')
  })

  it('prints the play time and the share beside the bar', () => {
    render(CoachHeroSplit, { props: { heroes: HEROES } })
    expect(screen.getByText('07:14')).toBeInTheDocument()
    expect(screen.getByText('62%')).toBeInTheDocument()
    expect(screen.getByText('Ana')).toBeInTheDocument()
  })

  it('takes canonical hero names from the labels prop', () => {
    render(CoachHeroSplit, { props: { heroes: [{ hero: 'dva', percent_played: 100 }], labels: { map: (s) => String(s), hero: () => 'D.Va' } } })
    expect(screen.getByText('D.Va')).toBeInTheDocument()
  })

  it('stays indeterminate rather than claiming 0% for a hero with no share', () => {
    render(CoachHeroSplit, { props: { heroes: [{ hero: 'juno', play_time: '11:40' }] } })
    expect(screen.getByRole('progressbar', { name: 'juno share' })).not.toHaveAttribute('aria-valuenow')
  })

  it('renders nothing when the match carries no hero roster', () => {
    render(CoachHeroSplit, { props: { heroes: [] } })
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})
