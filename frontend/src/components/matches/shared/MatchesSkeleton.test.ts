import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/vue'
import MatchesSkeleton from '@/components/matches/shared/MatchesSkeleton.vue'

// The skeleton rows are aria-hidden shimmer placeholders by design, so
// counting them requires reaching past the accessibility tree.

describe('MatchesSkeleton', () => {
  it('renders the default six skeleton rows', () => {
    const { baseElement } = render(MatchesSkeleton)
    // eslint-disable-next-line testing-library/no-node-access -- skeleton rows are aria-hidden shimmer placeholders
    expect(baseElement.querySelectorAll('.leaf-skeleton')).toHaveLength(6)
  })

  it('honors the rows prop', () => {
    const { baseElement } = render(MatchesSkeleton, { props: { rows: 3 } })
    // eslint-disable-next-line testing-library/no-node-access -- skeleton rows are aria-hidden shimmer placeholders
    expect(baseElement.querySelectorAll('.leaf-skeleton')).toHaveLength(3)
  })

  it('announces busy state for assistive tech', () => {
    render(MatchesSkeleton)
    // The named region + the busy list ARE the announcement; the
    // [data-matches-loading] hook the e2e spec waits on rides the same node.
    expect(screen.getByRole('region', { name: 'Loading matches' })).toBeInTheDocument()
    expect(screen.getByRole('list')).toHaveAttribute('aria-busy', 'true')
  })

  it('each skeleton row exposes the eight grid cells', () => {
    const { baseElement } = render(MatchesSkeleton, { props: { rows: 1 } })
    // checkbox, strip, when, map, hero, stats, meta, result — 8 children.
    // eslint-disable-next-line testing-library/no-node-access -- pins the skeleton's grid-cell structure, invisible to the a11y tree
    expect(baseElement.querySelector('.leaf-skeleton')?.children).toHaveLength(8)
  })
})
