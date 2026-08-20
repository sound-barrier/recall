/**
 * "This session" — what to work on, said while you can still act on it.
 *
 * The whole review cycle is retrospective except for this one moment: a
 * parse landing inside a live session is Recall's only evidence that the
 * player is at the keyboard between games. So the top three of their focus
 * list — a coach's items first — get said once, and once only.
 *
 * Driven over the same SSE mock the session tally uses: parse-complete →
 * refetch → the session is live → GET /focus → the toast.
 */
import AxeBuilder from '@axe-core/playwright'
import type { Page, Route } from '@playwright/test'

import { test, expect } from '../_fixtures'
import { emitParseEvent, installSSEMock, localStamp } from '../_session-sse'
import { pinTheme } from '../_theme-matrix'

const nudge = (page: Page) => page.getByRole('status', { name: 'What to focus on this session' })

function rec(minutesAgo: number, result: string) {
  const s = localStamp(minutesAgo)
  return {
    match_key: s.key,
    source_files: [`${s.key}.png`],
    data: {
      map: 'rialto', playlist: 'competitive', hero: 'lucio', result,
      date: s.date, finished_at: s.time, eliminations: 10, assists: 2, deaths: 4,
    },
    parsed_at: new Date().toISOString(),
  }
}

const FOCUS = [
  {
    item_id: 'c0000000-0000-4000-8000-000000000001',
    text: 'Hold the high ground until the second bubble.',
    status: 'new', source: 'coach', coach_name: 'Ordo', from: '2026-05-09',
  },
  { item_id: 'c0000000-0000-4000-8000-000000000002', text: 'Ult economy on control.', status: 'working', source: 'self', from: '2026-05-10' },
  { item_id: 'c0000000-0000-4000-8000-000000000003', text: 'Call the dive.', status: 'working', source: 'self', from: '2026-05-08' },
  { item_id: 'c0000000-0000-4000-8000-000000000004', text: 'A fourth thing.', status: 'working', source: 'self', from: '2026-05-07' },
]

async function harness(page: Page, focus: unknown[] = FOCUS) {
  await installSSEMock(page)
  let batch: unknown[] = []
  let focusReads = 0
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(batch) })
  })
  await page.route('**/api/v1/focus', async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    focusReads += 1
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(focus) })
  })
  return {
    setBatch: (next: unknown[]) => { batch = next },
    reads: () => focusReads,
    emit: () => emitParseEvent(page),
  }
}

test.describe('what to focus on this session', () => {
  test('says the top three when a parse lands inside a live session', async ({ page }) => {
    const h = await harness(page)
    await page.goto('/')
    await expect(page.getByRole('tab', { name: /^Matches/ })).toBeVisible()
    await expect(nudge(page)).toHaveCount(0)

    h.setBatch([rec(90, 'victory'), rec(50, 'victory'), rec(10, 'defeat')])
    await h.emit()

    await expect(nudge(page)).toBeVisible()
    const rows = nudge(page).getByRole('listitem')
    await expect(rows).toHaveCount(3)
    // A coach's item outranks the player's own, and says who sent it.
    await expect(rows.nth(0)).toContainText('Hold the high ground')
    await expect(rows.nth(0)).toContainText('Ordo')
    await expect(nudge(page).getByText('A fourth thing.')).toHaveCount(0)
  })

  // The no-network-on-mount rule: nothing reads the list until a parse the
  // user asked for has told Recall a session is live.
  test('reads nothing at boot', async ({ page }) => {
    const h = await harness(page)
    await page.goto('/')
    await expect(page.getByRole('tab', { name: /^Matches/ })).toBeVisible()
    await expect(nudge(page)).toHaveCount(0)
    expect(h.reads()).toBe(0)
  })

  test('says nothing when there is nothing to work on', async ({ page }) => {
    const h = await harness(page, [])
    await page.goto('/')
    await expect(page.getByRole('tab', { name: /^Matches/ })).toBeVisible()

    h.setBatch([rec(50, 'victory'), rec(10, 'defeat')])
    await h.emit()

    await expect(page.locator('.session-summary-toast')).toBeVisible()
    await expect(nudge(page)).toHaveCount(0)
  })

  // Once per session. Keyed on anything shorter and the same three lines
  // come back after every game, all evening.
  test('stays dismissed across the next parse in the same session', async ({ page }) => {
    const h = await harness(page)
    await page.goto('/')
    await expect(page.getByRole('tab', { name: /^Matches/ })).toBeVisible()

    h.setBatch([rec(90, 'victory'), rec(50, 'victory')])
    await h.emit()
    await expect(nudge(page)).toBeVisible()
    await nudge(page).getByRole('button', { name: 'Got it' }).click()
    await expect(nudge(page)).toHaveCount(0)

    h.setBatch([rec(90, 'victory'), rec(50, 'victory'), rec(10, 'defeat')])
    await h.emit()
    await expect(nudge(page)).toHaveCount(0)
  })
})

// The a11y sweep opens every view in every theme, but it never drives a
// parse — so this toast is the one surface it structurally cannot reach.
// It is also the only place `--accent` (its border) and `--accent-text`
// (its hover) sit together, so a token regression here would ship unseen.
test.describe('what to focus on this session — accessibility', () => {
  for (const theme of ['day', 'dark', 'night', 'high-contrast']) {
    test(`raises no axe violations in the ${theme} theme`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await pinTheme(page, theme)
      const h = await harness(page)
      await page.goto('/')
      await expect(page.getByRole('tab', { name: /^Matches/ })).toBeVisible()

      h.setBatch([rec(90, 'victory'), rec(50, 'victory'), rec(10, 'defeat')])
      await h.emit()
      await expect(nudge(page)).toBeVisible()

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
    })
  }
})
