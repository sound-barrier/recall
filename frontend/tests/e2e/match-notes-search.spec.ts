/**
 * Match-notes-search E2E.
 *
 * The FilterRail gains a free-text search input that substring-matches
 * against `annotation.note` content (case-insensitive). This spec
 * covers the happy path:
 *
 *   1. three matches load — one with note "ally rage-quit", one with
 *      "huge clutch", one with no annotation
 *   2. type "clutch" into the search input
 *   3. only the "huge clutch" match remains
 *   4. clear the input via the × button
 *   5. all three matches return
 *
 * Same `page.route()` mocking pattern as match-tags.spec.ts — no
 * mutation of state, just substring-matching against a canned list.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function record(matchKey: string, note?: string) {
  return {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    data: {
      map: 'rialto',
      mode: 'competitive',
      type: 'control',
      role: 'support',
      hero: 'lucio',
      result: 'victory',
      date: '2026-05-10',
      finished_at: '22:00',
      eliminations: 17,
      assists: 16,
      deaths: 11,
      damage: 7200,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
    ...(note ? { annotation: { leaver: '', note } } : {}),
  }
}

test.describe('match notes search', () => {
  test('substring filter narrows then clears', async ({ page }) => {
    const records = [
      record('match:1', 'ally rage-quit, threw the game'),
      record('match:2', 'huge clutch on the second point'),
      record('match:3'),
    ]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(records),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.leaf-row')).toHaveCount(3)

    // Type into the dedicated match-search input on the FilterRail.
    // The input carries aria-label="Search matches" so the selector
    // is stable against text/icon-only changes.
    const search = page.locator('input[aria-label="Search matches"]')
    await search.fill('clutch')
    await expect(page.locator('.leaf-row')).toHaveCount(1)

    // The clear control sits inline inside the input shell.
    await page.locator('button[aria-label="Clear search"]').click()
    await expect(search).toHaveValue('')
    await expect(page.locator('.leaf-row')).toHaveCount(3)
  })

  test('search is case-insensitive', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          record('match:1', 'Ally rage-quit'),
          record('match:2', 'huge clutch'),
        ]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('input[aria-label="Search matches"]').fill('ALLY')
    await expect(page.locator('.leaf-row')).toHaveCount(1)
  })
})

// ─── Hit-highlight + click-to-edit preview ─────────────────────
//
// Once a query narrows the list, the expanded card must surface
// the matched substring(s) inside the note. Because <textarea>
// can't render <mark>, the row swaps to a click-to-edit preview:
// default state is a div with marks; click promotes to a textarea
// at the click position; blur reverts to the preview with the
// (possibly edited) note re-highlighted against the live query.

test.describe('match notes search — hit highlighting in the expanded card', () => {
  test('matched substring renders as <mark> inside the note preview', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          record('match:1', 'huge CLUTCH on the second point — Juno carried'),
        ]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()

    await page.locator('input[aria-label="Search matches"]').fill('clutch')
    await page.locator('.leaf-row').first().click()

    const preview = page.locator('.match-notes-preview')
    await expect(preview).toBeVisible()
    // Case-insensitive — the literal text stays "CLUTCH" but the
    // wrapper is <mark class="note-hit">.
    const marks = preview.locator('mark.note-hit')
    await expect(marks).toHaveCount(1)
    await expect(marks.first()).toHaveText('CLUTCH')
    // Surrounding text remains intact.
    await expect(preview).toContainText('huge')
    await expect(preview).toContainText('Juno carried')
  })

  test('multiple hits highlight every occurrence', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          record('match:1', 'win win win — first win streak this week'),
        ]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('input[aria-label="Search matches"]').fill('win')
    await page.locator('.leaf-row').first().click()

    await expect(page.locator('.match-notes-preview mark.note-hit')).toHaveCount(4)
  })

  test('clicking the preview promotes it to a textarea (still focused)', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          record('match:1', 'huge clutch on the second point'),
        ]),
      })
    })
    await page.route('**/api/v1/matches/*/annotation', async (route: Route) => {
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('input[aria-label="Search matches"]').fill('clutch')
    await page.locator('.leaf-row').first().click()

    // Click → preview is replaced by the textarea, which is focused
    // (the user can keep typing without a second click).
    await page.locator('.match-notes-preview').click()
    const textarea = page.locator('textarea.match-notes-textarea')
    await expect(textarea).toBeVisible()
    await expect(textarea).toBeFocused()
    await expect(page.locator('.match-notes-preview')).toHaveCount(0)
  })

  test('blur after edit reverts to preview with the new text + hits', async ({ page }) => {
    let lastBody: Record<string, unknown> | null = null
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          record('match:1', 'huge clutch'),
        ]),
      })
    })
    await page.route('**/api/v1/matches/*/annotation', async (route: Route) => {
      lastBody = JSON.parse(route.request().postData() ?? '{}')
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('input[aria-label="Search matches"]').fill('clutch')
    await page.locator('.leaf-row').first().click()

    await page.locator('.match-notes-preview').click()
    const textarea = page.locator('textarea.match-notes-textarea')
    // Replace existing content with new text that also contains the
    // active query so the post-blur preview still has a hit.
    await textarea.fill('absolute clutch finish, MVP nano')
    await textarea.blur()

    // PUT carried the new note.
    expect(lastBody).not.toBeNull()
    expect((lastBody as { note?: string }).note).toBe('absolute clutch finish, MVP nano')

    // And the preview is back — with the active query still
    // highlighted.
    const preview = page.locator('.match-notes-preview')
    await expect(preview).toBeVisible()
    await expect(preview.locator('mark.note-hit')).toHaveCount(1)
    await expect(preview.locator('mark.note-hit').first()).toHaveText('clutch')
  })

  test('empty query renders preview WITHOUT marks (no false highlights)', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          record('match:1', 'huge clutch on the second point'),
        ]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    // No fill in the search input — query is empty.
    await page.locator('.leaf-row').first().click()

    const preview = page.locator('.match-notes-preview')
    await expect(preview).toBeVisible()
    await expect(preview.locator('mark.note-hit')).toHaveCount(0)
    await expect(preview).toContainText('huge clutch on the second point')
  })

  test('empty note keeps the textarea visible (no preview swap)', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([record('match:1') /* no note */]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()

    // Without a saved note, the editor must be ready to receive
    // the user's first character — no click-to-edit indirection.
    await expect(page.locator('textarea.match-notes-textarea')).toBeVisible()
    await expect(page.locator('.match-notes-preview')).toHaveCount(0)
  })
})
