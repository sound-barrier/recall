import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'

import { renderWidget } from '@/test-utils'
import RankPercentileWidget from '@/components/dashboard/widgets/RankPercentileWidget.vue'

// "Ranked above" reports a measurement the rank screen printed, not a modeled
// estimate — so the thing worth testing hardest is what it does when the
// measurement is ABSENT. Every capture predating season 4 has no percentile,
// and so does every placement screen; rendering those as 0% would state that
// the player is ranked above nobody, which is a lie that looks like data.
describe('RankPercentileWidget', () => {
  it('lists a row per role bucket with the reading', () => {
    renderWidget(RankPercentileWidget, {
      dossier: {
        currentRank: [
          { key: 'tank', label: 'Tank', tier: 'platinum', level: 2, progress: 67, percentile: 57 },
          { key: 'dps', label: 'DPS', tier: 'gold', level: 3, progress: 20, percentile: 38 },
        ],
      },
    })

    expect(screen.getByText('57%')).toBeInTheDocument()
    expect(screen.getByText('38%')).toBeInTheDocument()
    // The meter carries the value in ARIA, on the fill, per the repo's rule.
    expect(
      screen.getByRole('progressbar', { name: 'Tank — ranked above this share of players' }),
    ).toHaveAttribute('aria-valuenow', '57')
  })

  it('omits a role whose reading carried no percentile', () => {
    renderWidget(RankPercentileWidget, {
      dossier: {
        currentRank: [
          { key: 'tank', label: 'Tank', tier: 'platinum', level: 2, progress: 67, percentile: 57 },
          { key: 'dps', label: 'DPS', tier: 'gold', level: 3, progress: 20, percentile: null },
        ],
      },
    })

    expect(screen.getByText('57%')).toBeInTheDocument()
    expect(screen.queryByText('DPS')).not.toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })

  // Two empties, two different next actions — one needs a rank screenshot at
  // all, the other needs a newer one. Collapsing them would tell a season-3
  // user to go capture something they already have.
  it('distinguishes "no rank yet" from "rank, but no season-4 reading"', () => {
    const { unmount } = renderWidget(RankPercentileWidget, {
      dossier: {
        currentRank: [
          { key: 'tank', label: 'Tank', tier: 'gold', level: 1, progress: 40, percentile: null },
        ],
      },
    })
    expect(screen.getByText(/season 4/i)).toBeInTheDocument()
    unmount()

    renderWidget(RankPercentileWidget, { dossier: { currentRank: [] } })
    expect(screen.getByText(/capture a competitive rank screenshot/i)).toBeInTheDocument()
  })

  // A genuine 0 is a real reading — the bottom of the ladder — and must render
  // rather than be swallowed by a truthiness check.
  it('renders a genuine zero', () => {
    renderWidget(RankPercentileWidget, {
      dossier: {
        currentRank: [
          { key: 'tank', label: 'Tank', tier: 'bronze', level: 5, progress: 0, percentile: 0 },
        ],
      },
    })
    expect(screen.getByText('0%')).toBeInTheDocument()
  })
})
