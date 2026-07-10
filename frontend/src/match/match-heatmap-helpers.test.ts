import { describe, it, expect } from 'vitest'
import { heatmapCellClass, winrateVolumeFill } from '@/match/match-heatmap-helpers'

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

describe('heatmapCellClass — judgment bands', () => {
  const cell = (wins: number, losses: number, draws = 0) => ({
    total: wins + losses + draws,
    wins,
    losses,
    winrate: wins + losses === 0 ? 0 : Math.round((wins / (wins + losses)) * 100),
  })

  it('keeps the empty and all-draw classes', () => {
    expect(heatmapCellClass(cell(0, 0))).toBe('cell-empty')
    expect(heatmapCellClass(cell(0, 0, 3))).toBe('cell-draw')
  })

  it('a 52% record with real volume is a climb — win-coloured, not grey', () => {
    expect(heatmapCellClass(cell(52, 48))).toBe('cell-win')
    expect(heatmapCellClass(cell(208, 192))).toBe('cell-win') // 52% at n=400
  })

  it('the dead zone [48.5, 51] stays neutral at any volume', () => {
    expect(heatmapCellClass(cell(50, 50))).toBe('cell-mid')
    expect(heatmapCellClass(cell(510, 490))).toBe('cell-mid') // 51.0% — the band edge is neutral
    expect(heatmapCellClass(cell(97, 103))).toBe('cell-mid') // 48.5% — so is the bottom edge
    expect(heatmapCellClass(cell(490, 510))).toBe('cell-mid') // 49% — inside the zone, any volume
    expect(heatmapCellClass(cell(480, 520))).toBe('cell-loss') // 48% — outside it, with the volume to prove it
  })

  it('clearly-losing records with volume read loss', () => {
    expect(heatmapCellClass(cell(130, 170))).toBe('cell-loss') // 43.3% at n=300
    expect(heatmapCellClass(cell(7, 13))).toBe('cell-loss') // 35% at the evidence floor+
  })

  it('small samples stay neutral no matter how loud the rate', () => {
    expect(heatmapCellClass(cell(5, 0))).toBe('cell-mid') // a 5-0 heater is an evening, not evidence
    expect(heatmapCellClass(cell(0, 9))).toBe('cell-mid')
    expect(heatmapCellClass(cell(10, 0))).toBe('cell-mid') // even 10-0 — under the 15-decisive floor
    expect(heatmapCellClass(cell(6, 4))).toBe('cell-mid')
  })

  it('moderate volume needs a real edge to colour', () => {
    expect(heatmapCellClass(cell(12, 8))).toBe('cell-win') // 60% over 20 — a real signal
    expect(heatmapCellClass(cell(9, 7))).toBe('cell-mid') // 56% over 16 — not yet
    expect(heatmapCellClass(cell(5, 11))).toBe('cell-loss') // 31% over 16 — clearly bleeding
  })
})
