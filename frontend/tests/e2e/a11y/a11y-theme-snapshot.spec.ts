/**
 * Theme × view — structural + design-system snapshot.
 *
 * `a11y.spec.ts` runs axe-core across the same matrix, but axe is
 * selector-blind and only judges pass/fail contrast. It can't catch
 * "the high-contrast theme silently dropped the section-divider rule
 * and now the Settings rows blur together", and it can't catch the
 * slower rot this snapshot exists to measure: one visual concept
 * gradually acquiring a dozen slightly-different renderings.
 *
 * So each cell captures two things:
 *
 *   1. STRUCTURE — the theme actually applied, the shell is present,
 *      and every palette token resolves to something non-empty (catches
 *      a dropped or typo'd var() in one theme's cascade).
 *
 *   2. DESIGN-SYSTEM PROBES — for each visual family, the set of
 *      DISTINCT computed values in play. An `.eyebrow` family that
 *      renders at eight different font sizes and ten different
 *      letter-spacings shows up here as eight and ten entries; once
 *      consolidated it collapses to one. That makes both the drift and
 *      its repair visible in a reviewable diff, and it means any future
 *      PR that reintroduces a one-off variant has to explain a snapshot
 *      change.
 *
 * The probes use attribute-substring selectors (`[class*="eyebrow"]`)
 * rather than exact class names deliberately: they keep matching across
 * a rename from `.kpi-eyebrow` to `.eyebrow`, so the snapshot measures
 * the rendering, not the naming.
 *
 * Why structural JSON instead of pixel snapshots: Playwright pixel
 * snapshots are bound to the rendering OS (macOS local vs Linux CI), so
 * a literal `toHaveScreenshot` would flake on every commit unless the
 * suite ran in Docker. The JSON captured here is DOM + computed styles,
 * identical on every OS. Sufficient to catch "the theme dropped on the
 * floor"; not a substitute for design QA on real builds.
 *
 * Runs on chromium only — not by a skip, but because the webkit project
 * in playwright.config.ts is scoped to `*-webkit.spec.ts`. That matters
 * here: `snapshotPathTemplate` has no {projectName} segment, so if this
 * spec ever did run on both engines they would share one baseline file
 * and overwrite each other. Keep the filename off the webkit pattern.
 *
 * Replaces a11y-high-contrast-snapshot.spec.ts, which covered 4 views
 * against high-contrast only.
 */
import type { Page } from '@playwright/test'

import { test, expect } from '../_fixtures'
import { VIEWS, THEMES, openView } from '../_theme-matrix'

async function captureStructure(page: Page, tabId: string) {
  // NB: everything below runs serialized inside the browser, so the helper
  // functions must stay INSIDE the evaluate callback.
  return page.evaluate((tabIdInner) => {
    const rootStyle = getComputedStyle(document.documentElement)
    const tabBtn = document.getElementById(tabIdInner) as HTMLElement | null
    const main = document.getElementById('main-content')
    const masthead = document.querySelector('.masthead')

    // Palette tokens. Every one must resolve under every theme.
    const tokensOfInterest = [
      '--accent', '--accent-text', '--accent-glow', '--accent-soft',
      '--text', '--text-dim', '--text-faint', '--text-mute',
      '--surface', '--surface-2', '--surface-3', '--bg',
      '--border', '--border-soft', '--border-strong',
      '--win', '--loss', '--draw',
      '--tank', '--dps', '--support',
      '--identity-accent', '--primary-text-on-accent',
      // The paper family. It was absent until the plate went dark, which
      // meant a wholesale flip of every paper token produced ZERO snapshot
      // diff — the guard that exists to make a palette change reviewable
      // could not see the one surface that carries its own palette.
      '--paper', '--paper-2', '--paper-rule', '--paper-edge',
      '--ink', '--ink-dim', '--ink-faint',
      '--paper-accent', '--paper-win', '--paper-loss', '--paper-draw',
      '--paper-focus', '--paper-scheme',
    ]
    const cssTokens: Record<string, string> = {}
    for (const t of tokensOfInterest) {
      cssTokens[t] = rootStyle.getPropertyValue(t).trim()
    }

    // Design-system families. Each entry records how many elements are
    // in play and the SET of distinct computed values for the
    // properties that define the family's look.
    const families: Record<string, string[]> = {
      eyebrow: ['[class*="eyebrow"]'],
      card:    ['[class*="card"]'],
      panel:   ['[class*="panel"]'],
      button:  ['[class*="btn"]', 'button'],
      badge:   ['[class*="badge"]'],
      chip:    ['[class*="chip"]'],
      heading: ['h1', 'h2', 'h3', 'h4'],
    }
    const probeProps = [
      'fontSize', 'letterSpacing', 'fontWeight', 'textTransform',
      'color', 'backgroundColor', 'borderRadius',
    ] as const

    function paintedElements(selectors: string[]): Element[] {
      return Array.from(document.querySelectorAll(selectors.join(',')))
        .filter((el) => {
          // Ignore elements that aren't actually painted — a hidden
          // modal's styles are real but not part of this view's look,
          // and whether a modal happens to be in the DOM is noise.
          const r = (el as HTMLElement).getBoundingClientRect()
          return r.width > 0 && r.height > 0
        })
    }

    function familyProbe(selectors: string[]) {
      const els = paintedElements(selectors)
      const values: Record<string, Set<string>> = {}
      for (const p of probeProps) values[p] = new Set<string>()
      for (const el of els) {
        const cs = getComputedStyle(el)
        for (const p of probeProps) values[p]!.add(cs[p] as string)
      }
      return {
        count: els.length,
        ...Object.fromEntries(
          probeProps.map((p) => [p, Array.from(values[p]!).sort()]),
        ),
      }
    }

    function activeTabProbe(btn: HTMLElement | null) {
      return {
        id:           btn?.id ?? null,
        ariaSelected: btn?.getAttribute('aria-selected') ?? null,
        textContent:  btn?.textContent?.trim() ?? null,
      }
    }

    const designSystem: Record<string, unknown> = {}
    for (const [family, selectors] of Object.entries(families)) {
      designSystem[family] = familyProbe(selectors)
    }

    return {
      htmlAttr: { dataTheme: document.documentElement.getAttribute('data-theme') },
      activeTab: activeTabProbe(tabBtn),
      mainPresent:     !!main,
      mastheadPresent: !!masthead,
      cssTokens,
      designSystem,
    }
  }, tabId)
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

for (const theme of THEMES) {
  for (const view of VIEWS) {
    test(`${theme}: ${view.name} view structural snapshot`, async ({ page }) => {
      await openView(page, view.tabId, theme)

      const snapshot = await captureStructure(page, view.tabId)

      // Sanity: the theme actually applied.
      expect(snapshot.htmlAttr.dataTheme).toBe(theme)
      // Every token resolved to something non-empty — catches a
      // dropped/typo'd var() in this theme's cascade.
      for (const [name, value] of Object.entries(snapshot.cssTokens)) {
        expect(value, `expected ${name} to resolve under [data-theme="${theme}"]`).not.toBe('')
      }

      expect(JSON.stringify(snapshot, null, 2)).toMatchSnapshot(`${theme}-${view.name}-structure.json`)
    })
  }
}
