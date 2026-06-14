import { describe, it, expect } from 'vitest'
import TopRolesWidget from '@/components/widgets/TopRolesWidget.vue'
import type { Role } from '@/composables/useMatchesDossier'
import { mountWidget } from '@/test-utils/mountWidget'

const role = (key: Role, total: number, share: number, winrate = 50) => ({ key, total, share, winrate })

describe('TopRolesWidget', () => {
  it('renders one row per role with raw match count and share', () => {
    const w = mountWidget(TopRolesWidget, {
      dossier: {
        topRoles: [
          role('tank', 5, 50, 60),
          role('support', 3, 30, 33),
          role('dps', 2, 20, 50),
        ],
      },
    })
    const rows = w.findAll('li')
    expect(rows).toHaveLength(3)
    expect(rows[0]!.find('.bd-name').text()).toBe('tank')
    expect(rows[0]!.find('.bd-time').text()).toBe('5x')
    expect(rows[0]!.find('.bd-stats').text()).toBe('50%')
  })

  it('clamps the fill width at 100% even when share exceeds 100 (open-queue overlap)', () => {
    const w = mountWidget(TopRolesWidget, {
      dossier: { topRoles: [role('tank', 15, 150, 60)] },
    })
    const fill = w.find('.bd-fill').element as HTMLElement
    expect(fill.style.width).toBe('100%')
    // The bd-stats column still shows the raw share so the user knows
    // open-queue overlap pushed the sum past 100.
    expect(w.find('.bd-stats').text()).toBe('150%')
  })

  it('puts a winrate title on bars that have any matches', () => {
    const w = mountWidget(TopRolesWidget, {
      dossier: { topRoles: [role('tank', 5, 50, 60)] },
    })
    expect(w.find('.bd-bar').attributes('title')).toBe('60% winrate')
  })

  it('omits the winrate title when the role has no matches', () => {
    const w = mountWidget(TopRolesWidget, {
      dossier: { topRoles: [role('dps', 0, 0, 0)] },
    })
    expect(w.find('.bd-bar').attributes('title')).toBeUndefined()
  })
})
