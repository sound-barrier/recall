import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/vue'
import TopMapsWidget from '@/components/dashboard/widgets/TopMapsWidget.vue'
import { renderWidget } from '@/test-utils'

const entry = (key: string, total: number, share: number, winrate = 50) => ({ key, total, share, winrate })

describe('TopMapsWidget', () => {
  it('renders one row per map with name, count, share', () => {
    renderWidget(TopMapsWidget, {
      dossier: { topByCount: [entry('hanamura', 3, 38), entry('kings row', 2, 25)] },
    })
    // Height-filler placeholders are aria-hidden, so the role query
    // sees only real rows.
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('hanamura')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('3x')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('38%')).toBeInTheDocument()
    // The share bar communicates only through its width style — no
    // text or role to query.
    // eslint-disable-next-line testing-library/no-node-access -- style-only share bar has no accessible surface
    expect((rows[0]!.querySelector('.bd-fill') as HTMLElement).style.width).toBe('38%')
  })

  it('renders no real rows when no maps fed it', () => {
    renderWidget(TopMapsWidget, { dossier: { topByCount: [] } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('reserves rows to the UNFILTERED count (capped at the limit), padding the filtered gap', () => {
    const { baseElement } = renderWidget(TopMapsWidget, {
      // Filtered view shows 2 maps; the unfiltered set has 5 (≥ the limit).
      dossier:     { topByCount: [entry('hanamura', 3, 38), entry('kings row', 2, 25)] },
      fullDossier: { topByCount: [entry('a', 1, 20), entry('b', 1, 20), entry('c', 1, 20), entry('d', 1, 20), entry('e', 1, 20)] },
      configSeed: { 'top-maps': { limit: 5 } },
    })
    // 2 real + 3 placeholder = 5 rows → the widget keeps a constant height as the
    // active filter trims the list down from the full five. Placeholders are
    // aria-hidden height fillers by design, so counting them requires
    // reaching past the accessibility tree.
    // eslint-disable-next-line testing-library/no-node-access -- placeholders are aria-hidden height fillers; the reservation contract is invisible to role queries
    expect(baseElement.querySelectorAll('li')).toHaveLength(5)
    // eslint-disable-next-line testing-library/no-node-access -- placeholders are aria-hidden height fillers; the reservation contract is invisible to role queries
    expect(baseElement.querySelectorAll('li.bd-placeholder')).toHaveLength(3)
  })

  it('reserves no blank padding when the unfiltered set has fewer maps than the limit', () => {
    const { baseElement } = renderWidget(TopMapsWidget, {
      // Only two maps were ever played; the limit is 5 but there's nothing to
      // reserve for — no empty rows, vs the old fixed-limit padding.
      dossier:     { topByCount: [entry('hanamura', 3, 60), entry('kings row', 2, 40)] },
      fullDossier: { topByCount: [entry('hanamura', 3, 60), entry('kings row', 2, 40)] },
      configSeed: { 'top-maps': { limit: 5 } },
    })
    // eslint-disable-next-line testing-library/no-node-access -- placeholders are aria-hidden height fillers; the reservation contract is invisible to role queries
    expect(baseElement.querySelectorAll('li')).toHaveLength(2)
    // eslint-disable-next-line testing-library/no-node-access -- placeholders are aria-hidden height fillers; the reservation contract is invisible to role queries
    expect(baseElement.querySelectorAll('li.bd-placeholder')).toHaveLength(0)
  })

  it('renders the eyebrow label', () => {
    renderWidget(TopMapsWidget, { dossier: { topByCount: [] } })
    expect(screen.getByText('Most played maps')).toBeInTheDocument()
  })
})
