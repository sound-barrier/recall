import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/vue'

import BandHeaderControls from '@/components/matches/dossier/BandHeaderControls.vue'
import { JUDGMENT_LABEL } from '@/match/trends/match-heatmap-helpers'

// The legend is the one piece of band chrome that makes a CLAIM about the
// picture beside it, and it drifted twice: the swatches painted a red/green
// blend for cells that were grey, and the Campaign Log — a continuous ramp
// with no thresholds and no evidence floor — wore a three-verdict legend.
// What's pinned here is the claim, not the paint: the words the bands legend
// speaks, and the fact that the ramp legend speaks none of them.

function renderControls(legend?: 'bands' | 'ramp' | 'none') {
  return render(BandHeaderControls, {
    props: { windows: [3, 6, 12] as const, windowMonths: 6 as const, ...(legend ? { legend } : {}) },
  })
}

const legendWords = () =>
  within(screen.getByRole('list', { name: 'Cell-color legend' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent?.trim())

describe('BandHeaderControls — verdict legend', () => {
  it('speaks the shared judgment vocabulary, not hand-written synonyms', () => {
    renderControls() // no prop — the bands legend is what a band gets by default
    // These are JUDGMENT_LABEL's own words. The middle swatch is one grey for
    // two bands, so it names both — the eye cannot tell a level record from an
    // unproven one, and the legend must not pretend otherwise.
    expect(legendWords()).toEqual(['losing', 'even or too few games to judge', 'winning'])
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('renders no legend at all when a drilled view asks for none', () => {
    renderControls('none')
    expect(screen.queryByRole('list', { name: 'Cell-color legend' })).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })
})

describe('BandHeaderControls — continuous ramp legend', () => {
  it('replaces the three verdicts with one scale a screen reader hears as one thing', () => {
    renderControls('ramp')

    expect(screen.queryByRole('list', { name: 'Cell-color legend' })).toBeNull()
    // ONE graphic, not three swatches: the ramp has no bands to enumerate.
    const scale = screen.getAllByRole('img')
    expect(scale).toHaveLength(1)
    expect(scale[0]).toHaveAccessibleName(/ramps continuously from 0%.*to 100%/)
  })

  it('claims no verdict — the calendar records a day, it does not judge one', () => {
    renderControls('ramp')
    for (const verdict of Object.values(JUDGMENT_LABEL)) {
      expect(screen.queryByText(verdict)).toBeNull()
    }
    expect(screen.getByRole('img')).not.toHaveAccessibleName(/winning|losing|too few/)
  })
})
