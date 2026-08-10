import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/vue'
import TopRolesWidget from '@/components/dashboard/widgets/TopRolesWidget.vue'
import type { Role } from '@/composables/matches/useMatchesDossier'
import { renderWidget } from '@/test-utils'

const role = (key: Role, total: number, share: number, winrate = 50) => ({ key, total, share, winrate })

describe('TopRolesWidget', () => {
  it('renders one row per role with raw match count and share', () => {
    renderWidget(TopRolesWidget, {
      dossier: {
        topRoles: [
          role('tank', 5, 50, 60),
          role('support', 3, 30, 33),
          role('dps', 2, 20, 50),
        ],
      },
    })
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]!).getByText('tank')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('5x')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('50%')).toBeInTheDocument()
  })

  it('clamps the fill width at 100% even when share exceeds 100 (open-queue overlap)', () => {
    const { baseElement } = renderWidget(TopRolesWidget, {
      dossier: { topRoles: [role('tank', 15, 150, 60)] },
    })
    // The share bar communicates only through its width style — no
    // text or role to query.
    // eslint-disable-next-line testing-library/no-node-access -- style-only share bar has no accessible surface
    expect((baseElement.querySelector('.bd-fill') as HTMLElement).style.width).toBe('100%')
    // The stat column still shows the raw share so the user knows
    // open-queue overlap pushed the sum past 100.
    expect(screen.getByText('150%')).toBeInTheDocument()
  })

  it('puts a winrate title on bars that have any matches', () => {
    renderWidget(TopRolesWidget, {
      dossier: { topRoles: [role('tank', 5, 50, 60)] },
    })
    expect(screen.getByTitle('60% winrate')).toBeInTheDocument()
  })

  it('omits the winrate title when the role has no matches', () => {
    renderWidget(TopRolesWidget, {
      dossier: { topRoles: [role('dps', 0, 0, 0)] },
    })
    expect(screen.queryByTitle(/winrate/)).not.toBeInTheDocument()
  })
})
