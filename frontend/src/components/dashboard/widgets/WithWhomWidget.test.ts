import { describe, it, expect } from 'vitest'
import WithWhomWidget from '@/components/dashboard/widgets/WithWhomWidget.vue'
import { mountWidget } from '@/test-utils/mountWidget'

const entry = (key: string, total: number, winrate: number, share = 50) => ({ key, total, winrate, share })

describe('WithWhomWidget', () => {
  it('renders one row per teammate: name, win-rate bar + stat, count overlay', () => {
    const w = mountWidget(WithWhomWidget, {
      dossier: { withWhomBreakdown: [entry('Alice', 3, 67), entry('Bob', 2, 50), entry('Solo', 1, 100)] },
    })
    const rows = w.findAll('li')
    expect(rows).toHaveLength(3)
    expect(rows[0]!.find('.bd-name').text()).toBe('Alice')
    expect(rows[0]!.find('.bd-time').text()).toBe('3x')
    expect(rows[0]!.find('.bd-stats').text()).toBe('67%')
    // Bar width binds to WIN RATE (the comparison axis), not share.
    expect((rows[0]!.find('.bd-fill').element as HTMLElement).style.width).toBe('67%')
  })

  it('shows the teach-me empty state when no teammates are tagged', () => {
    const w = mountWidget(WithWhomWidget, { dossier: { withWhomBreakdown: [] } })
    expect(w.findAll('li')).toHaveLength(0)
    expect(w.find('.breakdown-empty').text()).toMatch(/tag teammates/i)
  })

  it('renders the eyebrow label', () => {
    const w = mountWidget(WithWhomWidget, { dossier: { withWhomBreakdown: [] } })
    expect(w.find('.breakdown-eyebrow').text()).toBe('Win rate by teammate')
  })
})
