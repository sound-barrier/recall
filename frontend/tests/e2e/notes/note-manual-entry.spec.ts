/**
 * The note on a hand-entered match, once it renders what it means.
 *
 * A manual match writes the same `annotation.note` every other surface reads,
 * so the form was the last place in the app where you typed markdown into a
 * plain textarea and only found out what it meant somewhere else. The field is
 * the shared writer now — which also means what the form SENDS is still the
 * markdown source, not the markup the editor paints.
 */
import type { Page, Route } from '@playwright/test'

import { routeCapture } from '../_capture'
import { test, expect } from '../_fixtures'

const refData = {
  heroes_by_role: { tank: ['Reinhardt'], damage: ['Tracer'], support: ['Ana'] },
  maps_by_game_mode: { control: ['Ilios'], hybrid: ["King's Row"] },
}

/** Open the full manual-entry form with an empty match list behind it. */
async function openForm(page: Page, posted?: ReturnType<typeof routeCapture<string>>) {
  await page.route('**/api/v1/system/reference-data', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(refData) }),
  )
  await page.route('**/api/v1/matches', async (route: Route) => {
    if (route.request().method() === 'POST') {
      posted?.set(route.request().postData() ?? '{}')
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  await page.goto('/')
  await page.getByRole('tab', { name: /^Matches/ }).click()
  await page.locator('[data-add-match]').click()
  await page.locator('[data-add-match-full]').click()
  await expect(page.locator('.mm-modal')).toBeVisible()
}

const noteField = (page: Page) => page.getByRole('textbox', { name: 'Notes' })

test.describe('the note on a hand-entered match', () => {
  test('renders what you type instead of showing the markers', async ({ page }) => {
    await openForm(page)
    await noteField(page).click()
    await page.keyboard.type('Held **the high ground**')

    await expect(noteField(page).getByText('the high ground')).toHaveRole('strong')
    await expect(noteField(page)).not.toContainText('**')
  })

  test('has the markdown one click away, like every other note', async ({ page }) => {
    await openForm(page)
    await noteField(page).click()
    await page.keyboard.type('Held **the high ground**')

    await page.getByRole('button', { name: 'Markdown', exact: true }).click()
    await expect(noteField(page)).toHaveValue('Held **the high ground**')
  })

  // The editor paints markup; the wire carries the source. A form that posted
  // what it painted would put HTML in a field every other surface parses as
  // markdown.
  test('sends the markdown source, not the markup it paints', async ({ page }) => {
    const posted = routeCapture<string>('manual-match POST body')
    await openForm(page, posted)

    await page.locator('[data-mode="competitive"]').click()
    await page.locator('[data-queue="role"]').click()
    await page.locator('[data-role="support"]').click()
    await page.locator('[data-result="victory"]').click()

    const mapCombo = page.locator('[data-combo-id="mm-map"]')
    await mapCombo.locator('.combo-input').click()
    await mapCombo.locator('.combo-input').fill('ili')
    await page.keyboard.press('Enter')
    const heroCombo = page.locator('[data-combo-id="mm-hero"]')
    await heroCombo.locator('.combo-input').click()
    await heroCombo.getByRole('option', { name: 'ana' }).click()

    await noteField(page).click()
    await page.keyboard.type('Held **the high ground**')
    await page.locator('[data-mm-submit]').click()

    await expect.poll(() => posted.seen()).toBe(true)
    const body = JSON.parse(posted.get()) as { note: string }
    expect(body.note).toBe('Held **the high ground**')
  })

  // The form is a modal with a focus trap, and the editor arrives on a dynamic
  // import — late enough that a trap which counted its focusables once, at
  // open, would never know the field exists.
  test('the editor is reachable by keyboard even though it arrives late', async ({ page }) => {
    await openForm(page)
    await noteField(page).click()
    await expect(noteField(page)).toBeFocused()

    // Tab leaves the field rather than being eaten — a contenteditable that
    // swallows Tab is a WCAG 2.1.2 keyboard trap axe does not catch — and it
    // lands somewhere still INSIDE the modal, which is the trap's own job. The
    // trap builds its ring from a selector that had no idea contenteditables
    // exist, so this is the assertion that noticed.
    await page.keyboard.press('Tab')
    await expect(noteField(page)).not.toBeFocused()
    const stillTrapped = await page.evaluate(
      () => document.querySelector('.mm-modal')?.contains(document.activeElement) ?? false)
    expect(stillTrapped).toBe(true)
  })
})
