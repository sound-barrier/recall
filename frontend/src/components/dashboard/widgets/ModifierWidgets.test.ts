import { describe, it, expect } from 'vitest'

import ModifierBreakdownWidget from '@/components/dashboard/widgets/ModifierBreakdownWidget.vue'
import UphillBattleWidget from '@/components/dashboard/widgets/UphillBattleWidget.vue'
import ReversalWidget from '@/components/dashboard/widgets/ReversalWidget.vue'
import { mountWidget } from '@/test-utils/mountWidget'

describe('ModifierBreakdownWidget', () => {
  it('renders a count + win-rate row per modifier, share-bar width', () => {
    const w = mountWidget(ModifierBreakdownWidget, {
      dossier: {
        modifierBreakdown: [
          { key: 'uphill battle', total: 6, winrate: 100, share: 40 },
          { key: 'reversal', total: 4, winrate: 0, share: 27 },
        ],
      },
    })
    expect(w.find('.breakdown-eyebrow').text()).toBe('Match modifiers')
    const rows = w.findAll('li')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('uphill battle')
    expect(rows[0]!.text()).toContain('6x')
    expect(rows[0]!.text()).toContain('100%')
    expect(rows[0]!.find('.bd-fill').attributes('style')).toContain('40%')
    // Title-cased for display via CSS.
    expect(rows[0]!.find('.mod-name').classes()).toContain('mod-name')
  })

  it('renders nothing when the set carries no modifiers', () => {
    const w = mountWidget(ModifierBreakdownWidget, { dossier: { modifierBreakdown: [] } })
    expect(w.findAll('li')).toHaveLength(0)
  })
})

describe('Uphill Battle / Reversal KPI widgets', () => {
  it('uphill battles shows the count of underdog wins', () => {
    const w = mountWidget(UphillBattleWidget, {
      dossier: { modifierRecord: { total: 7, winrate: 100 } },
    })
    expect(w.find('.kpi-eyebrow').text()).toBe('Uphill battles')
    expect(w.find('.kpi-value').text()).toBe('7')
    expect(w.find('.kpi-sub').text()).toContain('underdog')
  })

  it('reversals shows the count of favoured losses', () => {
    const w = mountWidget(ReversalWidget, {
      dossier: { modifierRecord: { total: 3, winrate: 0 } },
    })
    expect(w.find('.kpi-eyebrow').text()).toBe('Reversals')
    expect(w.find('.kpi-value').text()).toBe('3')
    expect(w.find('.kpi-sub').text()).toContain('favoured')
  })

  it('renders 0 when the modifier never appears (null record)', () => {
    const w = mountWidget(UphillBattleWidget, { dossier: { modifierRecord: null } })
    expect(w.find('.kpi-value').text()).toBe('0')
  })
})
