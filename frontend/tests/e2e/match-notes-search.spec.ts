/**
 * Match-notes E2E — preview / textarea swap inside the detail panel.
 *
 * The matches detail panel renders the note as a click-to-edit
 * preview: a `<div class="match-notes-preview">` when a note exists,
 * a `<textarea class="match-notes-textarea">` once the user clicks
 * into it. Empty-note records skip the preview swap and surface the
 * textarea directly so the user can type their first character.
 *
 * Includes hit-highlighting (`<mark class="note-hit">`) for the
 * active narrow-panel search query — App.vue wires
 * `matchesNarrowState.searchText` → `filters.matchQuery`
 * (TECHNICAL_DEBT.md item 19) so `searchClauses` lights up and
 * MatchCardExpanded renders `<mark>` around matching note segments.
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

test.describe('match notes — preview / textarea swap', () => {
  test('non-empty note renders as a preview that promotes to a textarea on click', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([record('match:1', 'huge clutch on the second point')]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    // Note preview renders the saved text.
    const preview = page.locator('.match-notes-preview')
    await expect(preview).toBeVisible()
    await expect(preview).toContainText('huge clutch on the second point')

    // Click → promotes to textarea, focused.
    await preview.click()
    const textarea = page.locator('textarea.match-notes-textarea')
    await expect(textarea).toBeVisible()
    await expect(textarea).toBeFocused()
    await expect(page.locator('.match-notes-preview')).toHaveCount(0)
  })

  test('blur after edit fires the PUT and reverts to the preview with the new text', async ({ page }) => {
    let lastBody: Record<string, unknown> | null = null
    // App.vue triggers a re-fetch of /api/v1/matches after the
    // annotation PUT lands; the mock has to return the UPDATED note
    // on that second GET, otherwise the preview re-renders from the
    // server response with the stale text and the assertion fails.
    let currentNote = 'huge clutch'
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([record('match:1', currentNote)]),
      })
    })
    await page.route('**/api/v1/matches/*/annotation', async (route: Route) => {
      lastBody = JSON.parse(route.request().postData() ?? '{}')
      currentNote = (lastBody?.note as string) ?? currentNote
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()

    await page.locator('.match-notes-preview').click()
    const textarea = page.locator('textarea.match-notes-textarea')
    await textarea.fill('absolute clutch finish, MVP nano')
    await textarea.blur()

    // PUT carried the new note via the unified annotation setter.
    await expect.poll(() => lastBody).not.toBeNull()
    expect((lastBody as { note?: string }).note).toBe('absolute clutch finish, MVP nano')

    // Preview is back with the new text.
    const preview = page.locator('.match-notes-preview')
    await expect(preview).toBeVisible()
    await expect(preview).toContainText('absolute clutch finish, MVP nano')
  })

  test('narrow-panel search highlights matching words inside the note preview', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([record('match-2026-05-10T22-00-00', 'absolute clutch finish, MVP nano')]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()

    // Open the narrow popover via `/` BEFORE opening the detail
    // panel — the panel's focus trap captures keystrokes once open,
    // so we have to land the search query first. App.vue's watcher
    // pipes searchText → matchQuery → searchClauses on every
    // keystroke, so by the time we click the row the highlighter
    // is already armed.
    await page.locator('.brand').first().click()
    await page.keyboard.press('/')
    const search = page.locator('#np-search')
    await expect(search).toBeFocused()
    await search.fill('clutch')

    // Dismiss the popover (Esc) and open the detail panel.
    await page.keyboard.press('Escape')
    await page.locator('.leaf-row').first().click()
    const preview = page.locator('.match-notes-preview')
    await expect(preview).toBeVisible()

    // The hit-highlight branch lights up: exactly one mark.note-hit
    // wraps the literal "clutch" inside the preview.
    const hit = preview.locator('mark.note-hit')
    await expect(hit).toHaveCount(1)
    await expect(hit).toHaveText('clutch')
  })

  test('record with no note skips the preview swap — textarea renders directly', async ({ page }) => {
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

    // No preview at all — the editor is ready to receive the user's
    // first character without a click-to-edit indirection.
    await expect(page.locator('textarea.match-notes-textarea')).toBeVisible()
    await expect(page.locator('.match-notes-preview')).toHaveCount(0)
  })
})
