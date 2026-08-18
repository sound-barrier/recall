import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'

import FormDeltaWidget from '@/components/dashboard/widgets/FormDeltaWidget.vue'
import { renderWidget } from '@/test-utils'

describe('FormDelta', () => {
  it('shows the recent rate with the signed gap vs overall', () => {
    renderWidget(FormDeltaWidget, {
      dossier: {
        formDelta: {
          recent:   { winrate: 65, sample: 20 },
          overall:  { winrate: 63, sample: 30 },
          deltaPts: 2,
        },
      },
    })
    expect(screen.getByText('65%')).toBeInTheDocument()
    // The up/down tint is spoken in the same vocabulary the bands use,
    // so the direction survives without the color.
    expect(screen.getByText('+2 pts')).toHaveAccessibleName('+2 pts — winning')
    expect(screen.getByText(/vs 63% overall/)).toHaveTextContent('n=20')
  })

  it('names a dead-level gap as even rather than picking a side', () => {
    renderWidget(FormDeltaWidget, {
      dossier: {
        formDelta: {
          recent:   { winrate: 55, sample: 20 },
          overall:  { winrate: 55, sample: 60 },
          deltaPts: 0,
        },
      },
    })
    expect(screen.getByText('0 pts')).toHaveAccessibleName('0 pts — even')
  })

  it('colors a negative gap as a down-trend', () => {
    renderWidget(FormDeltaWidget, {
      dossier: {
        formDelta: {
          recent:   { winrate: 40, sample: 20 },
          overall:  { winrate: 55, sample: 60 },
          deltaPts: -15,
        },
      },
    })
    expect(screen.getByText('-15 pts')).toHaveAccessibleName('-15 pts — losing')
  })

  it('renders an em-dash and no sub on an empty corpus', () => {
    renderWidget(FormDeltaWidget, {
      dossier: {
        formDelta: {
          recent:   { winrate: null, sample: 0 },
          overall:  { winrate: null, sample: 0 },
          deltaPts: null,
        },
      },
    })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/pts/)).not.toBeInTheDocument()
  })
})
