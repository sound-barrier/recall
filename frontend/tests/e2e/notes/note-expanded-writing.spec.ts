/**
 * The expanded writing mode.
 *
 * The journal's note field is a few rows at the bottom of a crowded panel.
 * That is right for a sentence and wrong for the long write-up after a bad
 * session, which is exactly when someone has the most to say.
 *
 * Expanding is not a different editor. It is the SAME NoteWriter, moved: same
 * value, same toolbar, same two modes, same save path — so nothing has to be
 * handed over and there is no state to lose on the way in or out.
 *
 * It stacks over the detail panel, which is itself a modal, so Escape has to
 * close exactly one of them. That is the same capture-phase problem the
 * screenshot lightbox already solves.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

function record(key: string, note?: string) {
  return {
    match_key: key,
    source_files: ['a.png'],
    source_types: { 'a.png': 'summary' },
    source_dir_ids: { 'a.png': 0 },
    data: { map: 'ilios', hero: 'ana', result: 'victory', date: '2026-05-10', finished_at: '22:30' },
    parsed_at: '2026-05-10T22:30:00Z',
    ...(note ? { annotation: { leavers: [], throwers: [], note } } : {}),
  }
}

async function openJournal(page: Page, note?: string) {
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([record('match:1', note)]),
    })
  })
  await page.goto('/')
  await page.getByRole('tab', { name: /^Matches/ }).click()
  await page.locator('.leaf-row').first().click()
  await expect(page.locator('aside.detail-panel')).toBeVisible()
  // The journal swaps a preview for the writer on click.
  await page.locator('.match-notes-preview').click()
}

const expandBtn = (page: Page) => page.getByRole('button', { name: 'Expand Note' })
const expanded = (page: Page) => page.getByRole('dialog', { name: 'Note' })

test.describe('expanded writing mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('opens the same note in a surface big enough to write in', async ({ page }) => {
    await openJournal(page, 'Hold **the high ground** first.')
    await expect(expanded(page)).toHaveCount(0)

    await expandBtn(page).click()
    await expect(expanded(page)).toBeVisible()
    // Same value, not a fresh field: the markup survives the move.
    await expect(expanded(page).getByRole('textbox', { name: 'Note' }).getByText('the high ground'))
      .toHaveRole('strong')
  })

  test('counts the words, because that is the number a long write-up is judged by', async ({ page }) => {
    await openJournal(page, 'one two three four five')
    await expandBtn(page).click()
    await expect(expanded(page).getByText('5 words')).toBeVisible()
  })

  test('says "1 word" rather than "1 words"', async ({ page }) => {
    await openJournal(page, 'alone')
    await expandBtn(page).click()
    await expect(expanded(page).getByText('1 word')).toBeVisible()
  })

  test('shows a live preview beside the source, but only in Markdown mode', async ({ page }) => {
    // In Formatted mode the editor IS the preview; a second copy of it would
    // be two panes showing the same thing.
    await openJournal(page, 'Hold **the high ground** first.')
    await expandBtn(page).click()
    await expect(expanded(page).getByRole('region', { name: 'Preview' })).toHaveCount(0)

    await expanded(page).getByRole('button', { name: 'Markdown', exact: true }).click()
    const preview = expanded(page).getByRole('region', { name: 'Preview' })
    await expect(preview).toBeVisible()
    await expect(preview.getByText('the high ground')).toHaveRole('strong')
  })

  test('what is typed while expanded is what the panel shows after closing', async ({ page }) => {
    let saved = ''
    await page.route('**/api/v1/matches/*/annotation', async (route: Route) => {
      const body = route.request().postDataJSON() as { note?: string }
      saved = body.note ?? ''
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
    })
    await openJournal(page, 'start')
    await expandBtn(page).click()

    const field = expanded(page).getByRole('textbox', { name: 'Note' })
    await field.click()
    await page.keyboard.type(' and more')
    await page.getByRole('button', { name: 'Done' }).click()

    await expect(expanded(page)).toHaveCount(0)
    await expect.poll(() => saved).toContain('and more')
  })

  test('Escape closes the writer and leaves the panel underneath open', async ({ page }) => {
    // One Escape, one modal. Without capture-phase ordering a single press
    // would tear down the detail panel too.
    await openJournal(page, 'Hold the high ground')
    await expandBtn(page).click()
    await expect(expanded(page)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(expanded(page)).toHaveCount(0)
    await expect(page.locator('aside.detail-panel')).toBeVisible()
  })

  test('leaves you where you were writing, not on the button that expanded it', async ({ page }) => {
    // The dialog convention restores focus to the trigger, but this trigger
    // REOPENS what was just closed — a Space or Enter from someone mid-
    // sentence would expand it straight back.
    await openJournal(page, 'Hold the high ground')
    await expandBtn(page).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('textbox', { name: 'Note' })).toBeFocused()
  })

  test('makes the panel underneath unreachable while it is open', async ({ page }) => {
    await openJournal(page, 'Hold the high ground')
    await expandBtn(page).click()
    await expect(page.locator('aside.detail-panel')).toHaveAttribute('inert', '')
  })

  test('keeps Tab inside it, so nothing invisible can be reached', async ({ page }) => {
    // It is an opaque full-viewport surface teleported to <body>. The inert
    // treatment covers .container, but AppOverlays and the toast layer live
    // outside it — so without containment, Tab walks onto controls the writer
    // is painting over. Pressing Enter on one of those navigates the app out
    // from under someone mid-sentence.
    await openJournal(page, 'Hold the high ground')
    await expandBtn(page).click()
    await expect(expanded(page)).toBeVisible()

    const inside: boolean[] = []
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab')
      inside.push(await page.evaluate(() => {
        const box = document.querySelector('.note-writer-expanded')
        const el = document.activeElement
        return !!box && !!el && box.contains(el)
      }))
    }
    expect(inside.every(Boolean), 'focus left the expanded writer').toBe(true)
  })

  test('freezes the page behind it', async ({ page }) => {
    // position: fixed covers the page; it does not stop the wheel.
    await openJournal(page, 'Hold the high ground')
    await expandBtn(page).click()
    await expect(expanded(page)).toBeVisible()
    const locked = await page.evaluate(() => document.documentElement.style.overflow)
    expect(locked).toBe('hidden')
  })

  test('puts the caret in the field, not on the page, as it opens', async ({ page }) => {
    // Half the time the first keystroke after Expand went to <body>: the
    // ProseMirror instance had just been moved by the Teleport.
    await openJournal(page, 'Hold the high ground')
    await expandBtn(page).click()
    await expect(expanded(page).getByRole('textbox', { name: 'Note' })).toBeFocused()
  })

  test('survives a click on its own margin, which takes focus off the field', async ({ page }) => {
    // Clicking the padding drops focus to <body>, firing focusout on the
    // writer. Forwarding that as a blur tells the journal "done editing",
    // which unmounts the writer — out from under a half-written note, on a
    // click that should have done nothing at all.
    await openJournal(page, 'Hold the high ground')
    await expandBtn(page).click()
    await expect(expanded(page)).toBeVisible()

    await expanded(page).click({ position: { x: 4, y: 4 } })
    await page.waitForTimeout(60)

    await expect(expanded(page)).toBeVisible()
    await expect(expanded(page).getByRole('textbox', { name: 'Note' })).toBeVisible()
  })
})
