/**
 * The coach's sheet — proven self-contained.
 *
 * A coach hands a player one HTML file. The player may not run Recall, may
 * open it a year later, may open it on a plane. It has to render with the
 * network off, forever.
 *
 * The unit suite asserts the builder emits no `url(`, no `<link>`, no
 * `http://`. That is a substring check on a string. This is the real
 * question: take the file the button ACTUALLY writes, put it in a browser,
 * forbid every request, and see whether it still says what it should.
 *
 * It also proves the half the unit suite cannot. Under Vitest, Vite's
 * `?inline` CSS imports resolve to the EMPTY STRING — so the builder's tests
 * run against no stylesheet at all, and "the sheet contains no url()" would
 * pass against an empty <style>. Here the bundle is real, so the CSS is
 * real, and a stylesheet that failed to inline shows up as an unpainted page.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from '../_fixtures'
import { confirmPlayer } from '../_coach'
import { seedProfiles, silenceParseEvents } from '../_theme-matrix'

const CODE = 'A1B2C3'
const KEY = `replay-${CODE}`

/** A server running one code-only session the coach has already written in. */
async function mockSessionForSheet(page: Page): Promise<void> {
  const state = { handle: '', notes: [] as Record<string, unknown>[] }
  const view = () => ({
    player: { id: '', handle: state.handle, message: '' },
    exported_at: '',
    session_date: '2026-08-15',
    match_count: 1,
    coach_name: 'Ordo',
    focus_items: [{ item_id: 'f-1', text: 'Count their Kiriko suzu' }],
    notes: state.notes,
    handle_from_bundle: false,
    source: 'replay',
  })

  await page.route('**/api/v1/coach/session/replay', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(view()) })
  })
  await page.route('**/api/v1/coach/session/player', async (route: Route) => {
    state.handle = (JSON.parse(route.request().postData() ?? '{}') as { handle: string }).handle
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(view()) })
  })
  await page.route('**/api/v1/coach/session/notes/**', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
    const note = {
      note_id: 'n-1', match_key: KEY, updated_at: '2026-08-15T09:00:00Z',
      focus_tags: [], extra_tags: [], match_clock: '', ...body,
    }
    state.notes = [note]
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(note) })
  })
  await page.route('**/api/v1/coach/session/matches', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        match_key: KEY,
        source_files: [],
        source: 'replay',
        source_types: {},
        data: { map: 'ilios', hero: 'ana', result: 'defeat', date: '2026-08-15' },
        annotation: { leavers: [], throwers: [], replay_code: CODE },
      }]),
    })
  })
  await page.route('**/api/v1/coach/session', async (route: Route) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ status: 204, body: '' })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(view()) })
  })
}

test.describe('the sheet a coach hands over', () => {
  test('is the file the button writes, and it renders with the network sealed', async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await seedProfiles(page)
    await silenceParseEvents(page)
    await mockSessionForSheet(page)

    await page.goto('/')
    await page.getByRole('tab', { name: /^Reviews/ }).click()
    await page.getByRole('button', { name: /Use a replay code/ }).click()
    const dialog = page.getByTestId('coach-from-codes')
    await dialog.getByRole('textbox', { name: 'Replay code' }).fill(CODE)
    await dialog.getByRole('button', { name: 'Add' }).click()
    await page.getByRole('button', { name: 'Start review' }).click()
    await confirmPlayer(page, 'Sable')

    // Write something worth handing over.
    const editor = page.getByRole('textbox', { name: /note/i }).first()
    await editor.click()
    await page.keyboard.type('Hold the high ground until their dive commits.')
    await editor.blur()

    // The real path: the button, the blob, the file on disk.
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: /save it as one page/i }).click()
    const download = await downloading
    const path = await download.path()
    const { readFileSync } = await import('node:fs')
    const html = readFileSync(path, 'utf8')

    // The CSS really inlined — the assertion the unit suite cannot make.
    expect(html).toContain('--paper')
    expect(html.length).toBeGreaterThan(10_000)

    // Now open it with the network sealed shut.
    const offline = await context.newPage()
    let requests = 0
    await offline.route('**/*', async (route: Route) => {
      requests++
      await route.abort()
    })
    await offline.setContent(html, { waitUntil: 'load' })

    await expect(offline.getByRole('heading', { name: 'Sable' })).toBeVisible()
    await expect(offline.getByText('Count their Kiriko suzu')).toBeVisible()
    await expect(offline.getByText('Hold the high ground until their dive commits.')).toBeVisible()
    await expect(offline.getByText(CODE, { exact: false }).first()).toBeVisible()

    expect(requests, 'the sheet fired network requests').toBe(0)

    // And it is actually PAINTED. An un-inlined stylesheet leaves the page on
    // browser defaults, which this catches and a substring check never would.
    const bg = await offline.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(bg).not.toBe('rgba(0, 0, 0, 0)')
  })
})
