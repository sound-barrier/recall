/**
 * Competitive rank tiers stay legible in every theme.
 *
 * The six tier colors (bronze → master) are fixed Overwatch identity
 * hues, and as hardcoded literals they were pale tints tuned for a
 * near-black ground: on Day's cream surface every one of them landed
 * between 1.04:1 and 2.24:1, so a Day user could not read their own
 * rank. They are tokens now, with a darkened Day set.
 *
 * a11y.spec.ts cannot catch this. The rank block only renders inside the
 * match detail panel, and that audit never opens it — which is exactly
 * how six invisible colors survived. This spec opens the panel and
 * computes the contrast itself.
 */
import { test, expect } from '../_fixtures'
import { THEMES, openView } from '../_theme-matrix'

// WCAG 2.x relative luminance + contrast ratio.
function contrast(fg: [number, number, number], bg: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const lum = (c: [number, number, number]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
  const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

function rgb(s: string): [number, number, number] {
  const n = s.match(/\d+/g)!.map(Number)
  return [n[0]!, n[1]!, n[2]!]
}

for (const theme of THEMES) {
  test(`rank tier chip clears WCAG AA in ${theme}`, async ({ page }) => {
    await openView(page, 'tab-matches', theme)
    await page.locator('.leaf-row').first().click()

    const tier = page.locator('.rank-tier').first()
    await expect(tier, 'the seeded rank record must render a tier chip').toBeVisible()

    const { color, bg } = await tier.evaluate((el) => {
      // Walk up for the first non-transparent background — the chip's own
      // surface is what the text actually sits on.
      let n: HTMLElement | null = el as HTMLElement
      let found = 'rgb(255, 255, 255)'
      while (n) {
        const b = getComputedStyle(n).backgroundColor
        if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) { found = b; break }
        n = n.parentElement
      }
      return { color: getComputedStyle(el as HTMLElement).color, bg: found }
    })

    const ratio = contrast(rgb(color), rgb(bg))
    expect(ratio, `${theme}: tier text ${color} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
  })
}
