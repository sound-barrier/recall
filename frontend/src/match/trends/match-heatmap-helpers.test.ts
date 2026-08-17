import { describe, it, expect } from 'vitest'
import {
  bucketCellJudgment,
  heatmapCellClass,
  heatmapCellJudgment,
  JUDGMENT_LABEL,
  resultJudgment,
  signJudgment,
} from '@/match/trends/match-heatmap-helpers'

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

  it('a 52% record is a climb — win-colored, not grey, at ANY volume past the floor', () => {
    expect(heatmapCellClass(cell(52, 48))).toBe('cell-win')
    expect(heatmapCellClass(cell(208, 192))).toBe('cell-win') // 52% at n=400

    // The regression this rewrite fixes: under the old 90-game shrinkage
    // prior, 52% needed >90 games ON THAT ONE CELL to color — so a
    // support player's 52% heroes sat grey at realistic per-hero volumes
    // while they were visibly climbing with them.
    expect(heatmapCellClass(cell(13, 12))).toBe('cell-win') // 52% at n=25 — same climb, sooner
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

  it('past the floor, clearing the band is all it takes — no extra volume tax', () => {
    expect(heatmapCellClass(cell(12, 8))).toBe('cell-win') // 60% over 20
    expect(heatmapCellClass(cell(9, 7))).toBe('cell-win') // 56% over 16
    expect(heatmapCellClass(cell(11, 9))).toBe('cell-win') // 55% over 20
    expect(heatmapCellClass(cell(16, 14))).toBe('cell-win') // 53.3% over 30
    expect(heatmapCellClass(cell(5, 11))).toBe('cell-loss') // 31% over 16 — clearly bleeding
  })
})

// The tint alone fails WCAG 1.4.1, so every judged surface appends a
// word from ONE vocabulary. These pin the words themselves — change one
// here and every heatmap cell, widget bar and KPI changes with it.
describe('the shared judgment vocabulary', () => {
  const cell = (wins: number, losses: number, draws = 0) => ({
    total: wins + losses + draws,
    wins,
    losses,
  })

  it('gives each judged band its word', () => {
    expect(heatmapCellJudgment(cell(16, 14))).toBe('winning') // 53.3% over 30
    expect(heatmapCellJudgment(cell(50, 50))).toBe('even') // dead zone, with volume
    expect(heatmapCellJudgment(cell(8, 22))).toBe('losing') // 27% over 30
  })

  it('separates the two greys the eye cannot: level vs not-yet-judged', () => {
    // Same class — deliberately, the palette has one neutral.
    expect(heatmapCellClass(cell(5, 0))).toBe(heatmapCellClass(cell(50, 50)))
    // Different words — a 5-0 evening must not be spoken as a verdict.
    expect(heatmapCellJudgment(cell(5, 0))).toBe('too few games to judge')
    expect(heatmapCellJudgment(cell(10, 0))).toBe('too few games to judge')
  })

  it('says what an all-draw and a never-played cell are, claiming nothing', () => {
    expect(heatmapCellJudgment(cell(0, 0, 3))).toBe('drawn')
    expect(heatmapCellJudgment(cell(0, 0))).toBe('no matches')
  })

  it('never lets an unjudged band borrow a verdict word', () => {
    for (const band of ['unproven', 'draw', 'empty'] as const) {
      expect(JUDGMENT_LABEL[band]).not.toBe(JUDGMENT_LABEL.win)
      expect(JUDGMENT_LABEL[band]).not.toBe(JUDGMENT_LABEL.loss)
    }
  })

  it('keeps every phrase distinct and non-empty, so no two bands sound alike', () => {
    const phrases = Object.values(JUDGMENT_LABEL)
    expect(phrases.filter((p) => p.length > 0)).toHaveLength(phrases.length)
    expect(new Set(phrases).size).toBe(phrases.length)
  })

  it('reads distribution buckets through the same words as the cells', () => {
    expect(bucketCellJudgment({ count: 30, wins: 16, decisive: 30 })).toBe('winning')
    expect(bucketCellJudgment({ count: 20, wins: 8, decisive: 20 })).toBe('losing')
    expect(bucketCellJudgment({ count: 10, wins: 10, decisive: 10 })).toBe('too few games to judge')
    expect(bucketCellJudgment({ count: 0, wins: 0, decisive: 0 })).toBe('no matches')
  })

  it('maps match results and signed movement onto those same words', () => {
    expect(resultJudgment('victory')).toBe(JUDGMENT_LABEL.win)
    expect(resultJudgment('defeat')).toBe(JUDGMENT_LABEL.loss)
    expect(resultJudgment('draw')).toBe(JUDGMENT_LABEL.draw)
    expect(signJudgment(45)).toBe(JUDGMENT_LABEL.win)
    expect(signJudgment(-20)).toBe(JUDGMENT_LABEL.loss)
    expect(signJudgment(0)).toBe(JUDGMENT_LABEL.even)
  })
})
