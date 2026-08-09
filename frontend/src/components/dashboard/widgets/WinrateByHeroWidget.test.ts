import { describe, it, expect } from 'vitest'
import WinrateByHeroWidget from '@/components/dashboard/widgets/WinrateByHeroWidget.vue'
import WinrateByMapWidget from '@/components/dashboard/widgets/WinrateByMapWidget.vue'
import WinrateByRoleWidget from '@/components/dashboard/widgets/WinrateByRoleWidget.vue'
import { mountWidget } from '@/test-utils/mountWidget'

const ROWS = [
  { key: 'ana', total: 8, winrate: 75, share: 75 },
  { key: 'lucio', total: 5, winrate: 60, share: 60 },
]

describe('Win-rate-by-X widgets', () => {
  it('hero widget renders win-rate rows with the sample count and a win-rate bar', () => {
    const w = mountWidget(WinrateByHeroWidget, { dossier: { winrateBy: ROWS } })
    expect(w.find('.breakdown-eyebrow').text()).toBe('Win-rate by hero')
    const rows = w.findAll('li')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('ana')
    expect(rows[0]!.text()).toContain('75%')
    expect(rows[0]!.text()).toContain('8x')
    expect(rows[0]!.find('.bd-fill').attributes('style')).toContain('75%')
  })

  it('map widget renders under its own eyebrow', () => {
    const w = mountWidget(WinrateByMapWidget, { dossier: { winrateBy: ROWS } })
    expect(w.find('.breakdown-eyebrow').text()).toBe('Win-rate by map')
    expect(w.findAll('li')).toHaveLength(2)
  })

  it('role widget renders proper role labels — DPS, not "Dps"', () => {
    const w = mountWidget(WinrateByRoleWidget, {
      dossier: { winrateBy: [
        { key: 'dps', total: 6, winrate: 50, share: 50 },
        { key: 'tank', total: 5, winrate: 40, share: 42 },
      ] },
    })
    expect(w.find('.breakdown-eyebrow').text()).toBe('Win-rate by role')
    const names = w.findAll('.bd-name').map((n) => n.text())
    expect(names).toEqual(['DPS', 'Tank'])
  })
})
