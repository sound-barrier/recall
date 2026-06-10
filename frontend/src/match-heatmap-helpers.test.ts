import { describe, it, expect } from 'vitest'
import { winrateVolumeFill } from './match-heatmap-helpers'

describe('winrateVolumeFill', () => {
  it('returns the empty tone for a zero-volume cell', () => {
    expect(winrateVolumeFill(0, 0, 10)).toBe('var(--heatmap-empty)')
    expect(winrateVolumeFill(80, 0, 10)).toBe('var(--heatmap-empty)')
  })

  it('encodes win rate as the green→red hue', () => {
    expect(winrateVolumeFill(67, 12, 12)).toContain('var(--win) 67%')
    expect(winrateVolumeFill(0, 5, 12)).toContain('var(--win) 0%')
  })

  it('saturates fully at the volume anchor and less below it', () => {
    // total == maxTotal → 100% saturation.
    expect(winrateVolumeFill(50, 12, 12)).toContain(' 100%,')
    // 4 / 12 volume → 20 + 4/12*80 = 47%.
    expect(winrateVolumeFill(50, 4, 12)).toContain(' 47%,')
    // A single game floors near the 20% baseline.
    expect(winrateVolumeFill(50, 1, 12)).toContain(' 27%,')
  })
})
