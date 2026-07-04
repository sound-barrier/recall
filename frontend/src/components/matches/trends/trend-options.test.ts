import { describe, it, expect } from 'vitest'

import { rankLadderOption, winrateOption, lineOption, rankDeltaOption } from '@/components/matches/trends/trend-options'

// The shared INTERACTION spreads a bottom zoom/pan slider into every
// TIMELINE chart. Narrow the dataZoom union down to the slider shape the
// assertions read.
interface SliderZoom {
  type?: string
  handleLabel?: { show?: boolean }
}

function sliderZoom(opt: { dataZoom?: unknown }): SliderZoom | undefined {
  const zooms = opt.dataZoom as SliderZoom[] | undefined
  return zooms?.find((z) => z.type === 'slider')
}

describe('trend-options — shared timeline interaction', () => {
  // Each timeline builder spreads the shared INTERACTION regardless of its
  // series, so an empty input still yields the slider config.
  const timelineBuilders: Record<string, () => { dataZoom?: unknown }> = {
    'rank ladder': () => rankLadderOption([]),
    'rolling win-rate': () => winrateOption([]),
    'generic line': () => lineOption([]),
    'rank delta': () => rankDeltaOption([]),
  }

  // echarts 6.1's dataZoom.handleLabel: the slider only labels its handles
  // on hover by default; we turn it always-on so dragging the zoom shows the
  // date at each end. This is the observable contract of Part A's cheap win.
  for (const [name, build] of Object.entries(timelineBuilders)) {
    it(`${name}: the zoom slider labels its handles`, () => {
      const slider = sliderZoom(build())
      expect(slider).toBeDefined()
      expect(slider?.handleLabel?.show).toBe(true)
    })
  }
})
