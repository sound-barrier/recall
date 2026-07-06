/**
 * Apply-previous-annotation E2E.
 *
 * Stack sessions repeat the same group members + tag set across many
 * matches. The Match Journal head gains an "Apply previous" button that
 * copies the chronologically previous annotated match's members + tags
 * into the open match's DRAFT — replacing the draft, firing no write —
 * and shows Confirm / Undo. Only Confirm persists (via the existing
 * PUT /annotation path); Undo restores the prior draft. Note, replay
 * code, and leaver are never copied.
 *
 * Round-trip proven here:
 *   1. GET /api/v1/matches returns an earlier annotated match + a later
 *      unannotated one.
 *   2. Open the later match's panel → the journal head shows Apply.
 *   3. Apply fills the Group + Tags cells with the copied values and
 *      NO PUT fires.
 *   4. Confirm PUTs members+tags (note/replay empty, leaver untouched).
 *   5. Undo restores the draft with no PUT.
 *   6. A match with no annotated predecessor shows no button.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const KEY_PREV = 'match-2026-05-10T20-00-00'
const KEY_CUR = 'match-2026-05-10T22-10-00'
const ANNOTATION_PATH_GLOB = `**/api/v1/matches/${encodeURIComponent(KEY_CUR)}/annotation`

const prevRecord = () => ({
  match_key: KEY_PREV,
  source_files: [`${KEY_PREV}.png`],
  data: {
    map: 'rialto',
    playlist: 'competitive',
    hero: 'lucio',
    result: 'victory',
    date: '2026-05-10',
    finished_at: '20:00',
  },
  parsed_at: '2026-05-10T20:30:00Z',
  annotation: { leaver: '', members: ['Apollo', 'Zed'], tags: ['stack'] },
})

const curRecord = () => ({
  match_key: KEY_CUR,
  source_files: [`${KEY_CUR}.png`],
  data: {
    map: 'numbani',
    playlist: 'competitive',
    hero: 'lucio',
    result: 'defeat',
    date: '2026-05-10',
    finished_at: '22:10',
  },
  parsed_at: '2026-05-10T22:30:00Z',
})

async function openPanelFor(page: import('@playwright/test').Page, mapText: RegExp) {
  await page.goto('/')
  await page.locator('.leaf-row', { hasText: mapText }).first().click()
  await expect(page.locator('.match-journal')).toBeVisible()
}

test.describe('apply previous annotation — journal head', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([prevRecord(), curRecord()]),
      })
    })
  })

  test('apply fills the draft chips without firing a PUT; confirm persists', async ({ page }) => {
    let putCount = 0
    let putBody: Record<string, unknown> | null = null
    await page.route(ANNOTATION_PATH_GLOB, async (route: Route) => {
      putCount++
      putBody = JSON.parse(route.request().postData() ?? '{}')
      await route.fulfill({ status: 204, body: '' })
    })

    await openPanelFor(page, /numbani/i)

    // Apply: draft fills, nothing persists yet, Confirm/Undo appear.
    await page.locator('[data-journal-apply]').click()
    await expect(page.locator('.member-chip-tag', { hasText: 'Apollo' })).toBeVisible()
    await expect(page.locator('.member-chip-tag', { hasText: 'Zed' })).toBeVisible()
    await expect(page.locator('button[data-tag-add="stack"]')).toHaveClass(/active/)
    expect(putCount).toBe(0)

    // Confirm: exactly one PUT carrying the copied members + tags.
    await page.locator('[data-journal-apply-confirm]').click()
    await expect.poll(() => putCount).toBe(1)
    expect(putBody).toEqual({
      leaver: '',
      note: '',
      replay_code: '',
      members: ['Apollo', 'Zed'],
      tags: ['stack'],
    })
    await expect(page.locator('[data-journal-apply-confirm]')).toHaveCount(0)
  })

  test('undo restores the prior draft and never PUTs', async ({ page }) => {
    let putCount = 0
    await page.route(ANNOTATION_PATH_GLOB, async (route: Route) => {
      putCount++
      await route.fulfill({ status: 204, body: '' })
    })

    await openPanelFor(page, /numbani/i)

    await page.locator('[data-journal-apply]').click()
    await expect(page.locator('.member-chip-tag', { hasText: 'Apollo' })).toBeVisible()

    await page.locator('[data-journal-apply-undo]').click()
    await expect(page.locator('.member-chip-tag')).toHaveCount(0)
    await expect(page.locator('button[data-tag-add="stack"]')).not.toHaveClass(/active/)
    await expect(page.locator('[data-journal-apply]')).toBeVisible()
    expect(putCount).toBe(0)
  })

  test('no annotated predecessor — the button is absent', async ({ page }) => {
    // The earlier match IS the oldest record: nothing precedes it.
    await openPanelFor(page, /rialto/i)
    await expect(page.locator('[data-journal-apply]')).toHaveCount(0)
  })
})
