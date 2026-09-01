import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'
import type { MatchRecord } from '@/api-client'
import HeroTrendLinesWidget from '@/components/dashboard/widgets/HeroTrendLinesWidget.vue'
import { renderWidget } from '@/test-utils'

function rec(hero: string, result: string, day: number): MatchRecord {
  return {
    match_key: `${hero}-${day}-${result}`,
    data: {
      hero, result,
      date: `2026-08-${String(day).padStart(2, '0')}`, finished_at: '20:00',
      played_at_utc: `2026-08-${String(day).padStart(2, '0')}T20:00:00Z`,
    },
  } as unknown as MatchRecord
}

function history(hero: string, results: string[]): MatchRecord[] {
  return results.map((r, i) => rec(hero, r, i + 1))
}

describe('HeroTrendLinesWidget', () => {
  it('draws a line per hero, labeled with what the line shows', () => {
    // A chart whose accessible name is only its title tells a screen-reader
    // user nothing about the data — WCAG 1.1.1 wants the equivalent.
    renderWidget(HeroTrendLinesWidget, {
      dossier: { records: history('ana', ['victory', 'victory', 'defeat', 'victory']) },
      configSeed: { 'hero-trend-lines': { window: 5, limit: 5 } },
    })
    expect(screen.getByRole('img', { name: /Rolling win rate ana:/ })).toBeInTheDocument()
  })

  it(`captions the line with that hero's LATEST rolling rate, not its first`, () => {
    // Four straight wins would caption 100% whichever end the code read, so
    // the record has to actually move: the first two-game window is 50%, the
    // last is 0%.
    renderWidget(HeroTrendLinesWidget, {
      // Five wins then five losses over a five-game window: the first point
      // is 100%, the last is 0%. Reading either end gives a different answer,
      // which is what makes the assertion mean something.
      dossier: { records: history('ana', [
        'victory', 'victory', 'victory', 'victory', 'victory',
        'defeat', 'defeat', 'defeat', 'defeat', 'defeat',
      ]) },
      configSeed: { 'hero-trend-lines': { window: 5, limit: 5 } },
    })
    expect(screen.getByText('ana')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.queryByText('100%')).not.toBeInTheDocument()
  })

  it('says there is nothing to trend rather than drawing an empty chart', () => {
    renderWidget(HeroTrendLinesWidget, { dossier: { records: [] } })
    expect(screen.getByText('Not enough decisive games on any hero yet.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
