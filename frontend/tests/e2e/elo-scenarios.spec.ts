/*
 * Elo Calculator scenario harness — renders 30 deterministic competitive
 * histories (_elo-scenarios.ts) through the REAL page and snapshots every
 * card's text as JSON. The snapshots are the regression surface for the
 * page's wording and statistics: any copy or model change re-baselines a
 * reviewable per-scenario diff instead of shipping silently.
 *
 * JSON text captures only — no pixel screenshots (see playwright.config.ts).
 * Adds ~60-90s to the suite (30 scenarios × route-mock + one evaluate).
 */
import type { Route, Page } from '@playwright/test'

import { test, expect } from './_fixtures'
import { SCENARIOS, buildRows } from './_elo-scenarios'

function localYMD(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const REFERENCE_DATA = {
  heroes_by_role: { support: ['Lúcio', 'Ana'], dps: ['Ashe'], tank: ['Zarya'] },
  maps_by_game_mode: { control: ['Ilios'] },
  screenshot_sources: [],
  seasons: [],
}

// Every attribute the page exposes for testing, keyed for stable sorting.
// Inputs/selects capture .value; everything else normalized textContent.
const CAPTURE_ATTRS = [
  'data-elo-answer',
  'data-elo-card',
  'data-elo-timeline',
  'data-elo-know',
  'data-elo-sim',
  'data-elo-sim-stat',
  'data-elo-stat',
  'data-elo-evidence',
  'data-elo-skill-share',
  'data-elo-changepoint',
  'data-elo-chart-caption',
  'data-elo-plateau',
  'data-elo-slope-hint',
  'data-elo-delta-strip',
  'data-elo-hero-gap',
  'data-elo-next-moves',
  'data-elo-lift',
  'data-elo-whatif-summary',
  'data-elo-input',
  'data-elo-current',
  'data-elo-target',
]

async function captureCards(page: Page): Promise<string> {
  const raw = await page.evaluate((attrs: string[]) => {
    const out: Record<string, string> = {}
    for (const attr of attrs) {
      const nodes = Array.from(document.querySelectorAll(`[${attr}]`))
      nodes.forEach((el, i) => {
        const val = el.getAttribute(attr)
        const suffix = nodes.length > 1 && !val ? `#${i}` : ''
        const key = `${attr}${val ? `=${val}` : ''}${suffix}`
        const text =
          el instanceof HTMLInputElement || el instanceof HTMLSelectElement
            ? String(el.value)
            : (el.textContent ?? '')
        out[key] = text.replace(/\s+/g, ' ').trim()
      })
    }
    return out
  }, CAPTURE_ATTRS)
  // Relative fixtures shift with the calendar — normalize month-day
  // fragments AND weekday names (the lift table buckets by day of week,
  // so its labels rotate with the run date: a weekday-bomb that would
  // fail CI on any other day). Month/day names only: a looser
  // [A-Z][a-z]+ pattern would swallow rank names like "Silver 5".
  //
  // The guard is a negative lookbehind for a LETTER, not \b. textContent
  // here is concatenated cell-by-cell with no separators, so a label
  // routinely arrives glued to the previous cell's digits
  // ("×1.385Wednesdays"). Between "5" and "W" both sides are word
  // characters, so \b does not match there and every label after the
  // first survived normalization — which is exactly how this suite came
  // to fail in CI one day after the snapshots were taken, with each
  // weekday shifted by one. The lookbehind still refuses a mid-word
  // match ("Janitor 5"), which is what the \b was there for.
  const normalized: Record<string, string> = {}
  const datePattern = /(?<![A-Za-z])(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}\b/g
  const dayPattern = /(?<![A-Za-z])(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day(s)?\b/g
  for (const key of Object.keys(raw).sort()) {
    normalized[key] = raw[key]!.replace(datePattern, '<DATE>').replace(dayPattern, '<DAY>$2')
  }
  return JSON.stringify(normalized, null, 2)
}

async function openScenario(page: Page, rows: unknown[]): Promise<void> {
  await page.route('**/api/v1/system/reference-data', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REFERENCE_DATA) }))
  await page.route('**/api/v1/matches', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) }))
  await page.goto('/')
  await page.locator('#tab-elo').click()
  await expect(page.locator('#panel-elo')).toBeVisible()
  // A real verdict, not the empty-state fallback — not.toHaveText('') was
  // vacuously satisfied by "Pick a track with ranked games…".
  await expect(page.locator('[data-elo-answer]')).not.toContainText('Pick a track')
}

test.describe('Elo Calculator — 30-scenario wording/statistics captures', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  for (const spec of SCENARIOS) {
    test(`${spec.id}: ${spec.note}`, async ({ page }) => {
      await openScenario(page, buildRows(spec, localYMD))

      if (spec.interact === 'pick-two-heroes') {
        await page.locator('[data-elo-hero="lucio"] .elo-hero-row').click()
        await page.locator('[data-elo-hero="ana"] .elo-hero-row').click()
      } else if (spec.interact === 'nudge-lucio-plus-3') {
        const up = page.locator('[data-elo-hero="lucio"] [data-elo-nudge="up"]')
        await up.click()
        await up.click()
        await up.click()
      }

      expect(await captureCards(page)).toMatchSnapshot(`${spec.id}.json`)
    })
  }
})
