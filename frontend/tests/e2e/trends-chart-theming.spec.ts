/**
 * Trends charts follow the active theme — verified at the pixel level.
 *
 * ECharts draws to a canvas, so it cannot inherit CSS. The series hues were
 * therefore hardcoded in trend-options.ts, which froze every chart to the
 * Night palette: a Tank line drew #5ca8ff over Day's cream ground while a
 * Tank badge three inches away drew var(--tank) = #1f5491. Nothing caught
 * it — a canvas is opaque to axe, to the DOM snapshots, and to every
 * locator-based assertion in this suite.
 *
 * So this spec reads the rendered pixels back. It samples the dominant
 * colours out of the canvas under two palettes and asserts they differ,
 * which is the one check that actually exercises
 * token -> themeColor() -> option -> ECharts -> paint.
 */
import { test, expect } from './_fixtures'
import { openView } from './_theme-matrix'
async function chartPixels(page: import('@playwright/test').Page): Promise<string> {
  await page.locator('.trends-toggle').click()
  // Specifically the rolling win-rate card, NOT `.trend-card canvas` first():
  // that resolves to "Rank over time", which the audit corpus barely
  // populates (one rank reading), so it paints a lone marker and no role
  // series. Win-rate is driven by all 24 decisive matches across three
  // roles, so tank/dps/support lines are guaranteed to be on screen.
  const canvas = page
    .locator('.trend-card')
    .filter({ has: page.locator('.trend-card-title', { hasText: 'Rolling win-rate' }) })
    .locator('canvas')
    .first()
  await expect(canvas).toBeVisible()

  // Poll rather than sleep. ECharts rides a lazily-imported chunk, so on a
  // cold run the canvas is visible-but-unpainted for a while and a fixed
  // wait samples nothing but axis grey — which passed only when an earlier
  // spec had already warmed the chunk. Wait for the series to actually
  // exist: a SATURATED pixel (max-min channel spread), which chrome greys
  // and near-whites can never produce.
  const dominant = async () =>
    canvas.evaluate((el) => {
      const c = el as HTMLCanvasElement
      const ctx = c.getContext('2d')
      if (!ctx || !c.width) return ''
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      const seen = new Map<string, number>()
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3]! < 200) continue
        const [r, g, b] = [d[i]!, d[i + 1]!, d[i + 2]!]
        if (Math.max(r, g, b) - Math.min(r, g, b) < 40) continue
        seen.set(`${r},${g},${b}`, (seen.get(`${r},${g},${b}`) ?? 0) + 1)
      }
      return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k).join(' | ')
    })

  await expect.poll(dominant, {
    message: 'chart never painted a saturated series colour',
    timeout: 15_000,
  }).not.toBe('')
  return dominant()
}

test('series colours are repainted from the palette on a theme change', async ({ page }) => {
  await openView(page, 'tab-matches', 'night')
  const night = await chartPixels(page)
  await openView(page, 'tab-matches', 'day')
  const day = await chartPixels(page)
  // Night's --tank/--accent/--support vs Day's. Asserting on the specific
  // tokens rather than "something changed" so a future palette edit that
  // accidentally decouples the chart from the theme still fails here.
  expect(night, 'night chart should paint the night role colours').toContain('106,184,255')
  expect(day, 'day chart should paint the day role colours').toContain('31,84,145')
  expect(day).not.toBe(night)
})
