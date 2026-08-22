/**
 * The match journal's note, once it renders what it means.
 *
 * The journal note has always been the plainest field in the app — plain text
 * on the way in and plain text on the way out — while the review note beside
 * it was markdown all along. Both are the same `annotation.note` on the wire,
 * so a note written in one and read in the other disagreed with itself.
 *
 * It renders now, on both sides of the click-to-edit swap. The swap survives
 * because the panel can hold many journals at once and mounting a document
 * editor in each would cost real bytes for a field most of them never touch —
 * the preview paints the same markup the editor does, so nothing about the
 * exchange is visible.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

function record(matchKey: string, note?: string) {
  return {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control',
      role: 'support', hero: 'lucio', result: 'victory',
      date: '2026-05-10', finished_at: '22:00',
      eliminations: 17, assists: 16, deaths: 11, damage: 7200,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
    ...(note ? { annotation: { leavers: [], throwers: [], note } } : {}),
  }
}

/**
 * Open the journal, optionally with a narrow search already armed.
 *
 * The search has to land BEFORE the panel opens: the panel is a modal with a
 * focus trap and an inert background, so once it is up the tabs and the narrow
 * popover are unreachable — which is a correct modal and an unhelpful test
 * order. Same dance as match-notes-search.spec.ts.
 */
async function openJournal(page: Page, note?: string, search?: string) {
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([record('match:1', note)]),
    })
  })
  await page.goto('/')
  await page.getByRole('tab', { name: /^Matches/ }).click()

  if (search !== undefined) {
    await page.locator('.brand').first().click()
    await page.keyboard.press('/')
    const field = page.locator('#np-search')
    await expect(field).toBeFocused()
    await field.fill(search)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
  }

  await page.locator('.leaf-row').first().click()
  await expect(page.locator('aside.detail-panel')).toBeVisible()
}

const preview = (page: Page) => page.locator('.match-notes-preview')
const note = (page: Page) => page.getByRole('textbox', { name: 'Note' })

test.describe('the journal note renders', () => {
  test('the preview shows markup, not the markers', async ({ page }) => {
    await openJournal(page, 'Hold **the high ground** first.')

    await expect(preview(page).getByText('the high ground')).toHaveRole('strong')
    await expect(preview(page)).not.toContainText('**')
  })

  test('a list written here is a list, the way the coach would see it', async ({ page }) => {
    await openJournal(page, '# Ult economy\n\n- hold it for the dive\n- count their suzu')

    await expect(preview(page).getByRole('heading', { name: 'Ult economy' })).toBeVisible()
    await expect(preview(page).getByRole('listitem')).toHaveCount(2)
  })

  // The swap is meant to be invisible: the same markup on both sides of it.
  test('the editor shows what the preview showed', async ({ page }) => {
    await openJournal(page, 'Hold **the high ground** first.')
    await preview(page).click()

    await expect(note(page).getByText('the high ground')).toHaveRole('strong')
    await expect(note(page)).not.toContainText('**')
  })

  test('the markdown is one click away here too', async ({ page }) => {
    await openJournal(page, 'Hold **the high ground** first.')
    await preview(page).click()
    await page.getByRole('button', { name: 'Markdown', exact: true }).click()

    await expect(page.getByRole('textbox', { name: 'Note' }))
      .toHaveValue('Hold **the high ground** first.')
  })

  // The journal swaps the writer away when editing ends, and the field's own
  // blur used to be what ended it — so reaching for Bold closed the editor
  // before the press landed. Focus moving between a writer's own controls is
  // not leaving the writer.
  test('reaching for the toolbar does not close the editor', async ({ page }) => {
    await openJournal(page, 'Hold the high ground')
    await preview(page).click()
    await note(page).click()

    await page.keyboard.press('ControlOrMeta+a')
    await page.getByRole('button', { name: 'Bold' }).click()

    // Still open, and the press landed on the note rather than on nothing.
    await expect(note(page)).toBeVisible()
    await expect(note(page).getByText('Hold the high ground')).toHaveRole('strong')
  })
})

test.describe('a search keeps its hits lit', () => {
  // Highlighting can never alter a note: in the preview it is markup wrapped
  // around what the parser already produced, and in the editor it is a
  // decoration the document never learns about. Neither is stored.
  test('lights the hit in the preview, inside emphasis', async ({ page }) => {
    await openJournal(page, 'Hold **the high ground** first.', 'ground')

    // Found INSIDE the emphasis — the old highlighter searched the source, so
    // a word wrapped in markers was unfindable.
    await expect(preview(page).locator('mark.note-hit')).toHaveText('ground')
    // …and the ⌕ the preview pins when a search landed inside it. Both used to
    // miss this note: the old highlighter walked the raw markdown, where the
    // word was buried between markers.
    await expect(preview(page)).toHaveClass(/has-hits/)
  })

  test('keeps the hit lit while you type, without writing it into the note', async ({ page }) => {
    let saved = ''
    await page.route('**/api/v1/matches/*/annotation', async (route: Route) => {
      saved = (JSON.parse(route.request().postData() ?? '{}') as { note?: string }).note ?? ''
      await route.fulfill({ status: 204, body: '' })
    })
    await openJournal(page, 'Hold the high ground', 'ground')
    await preview(page).click()

    // Lit while the field is live and editable…
    await expect(note(page).locator('mark.note-hit, .note-hit')).toHaveCount(1)

    // Gate on the editor being HYDRATED and focused before typing. Clicking
    // the preview swaps in the WYSIWYG field, which seeds itself from the
    // draft; a keystroke that lands mid-seed is overwritten by it, and the
    // note comes back empty or a character short. The highlight above proves
    // the field exists, not that it has finished taking its content.
    await expect(note(page)).toContainText('Hold the high ground')
    await expect(note(page)).toBeFocused()

    await page.keyboard.type(' first')
    await note(page).blur()

    // …and not a character of it reached the note.
    await expect.poll(() => saved).toBe('Hold the high ground first')
  })
})
