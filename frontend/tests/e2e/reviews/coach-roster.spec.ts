/**
 * The roster becomes a door — the coach's continuity, made visible.
 *
 * Everything a coach writes is per-player and permanent, but until now the
 * roster was a read-only line: no way back into a player short of being
 * handed a new bundle. These specs pin the three affordances of the
 * dossier: the row opens it, "Read every note" lists the stored notes
 * (dated by their match keys — replay keys by their code), and "Review new
 * codes" opens the codes modal pre-addressed, so the identity prompt never
 * has to ask about someone the coach already knows.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from '../_fixtures'
import { seedProfiles, silenceParseEvents } from '../_theme-matrix'

const tab = (page: Page) => page.getByRole('tab', { name: /^Reviews/ })
const panel = (page: Page) => page.locator('#panel-reviews')

const ROSTER = [
  {
    id: 2, handle: 'Sable', kind: 'player', note_count: 3,
    last_note_at: '2026-08-14T20:00:00Z', focus_items: ['Ult economy first.'],
  },
  { id: 1, handle: 'Sound Barrier', kind: 'team', note_count: 2, last_note_at: '2026-08-01T10:00:00Z' },
]

const SABLE_NOTES = [
  {
    note_id: 'n-1', match_key: 'match-2026-08-13T22-30-00', kind: 'note',
    text: 'Hold the high ground until their dive commits.',
    focus_tags: ['positioning'], extra_tags: [], match_clock: '06:40',
    updated_at: '2026-08-14T20:00:00Z',
  },
  {
    note_id: 'n-2', match_key: 'replay-A1B2C3', kind: 'note',
    text: 'Ult count was never spoken.',
    focus_tags: [], extra_tags: [], match_clock: '',
    updated_at: '2026-08-10T19:00:00Z',
  },
]

async function seedRoster(page: Page): Promise<void> {
  await page.route('**/api/v1/coach/players', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(ROSTER),
    })
  })
  await page.route('**/api/v1/coach/players/2/notes', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(SABLE_NOTES),
    })
  })
}

test.describe('the coach roster is a door', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await seedProfiles(page)
    await silenceParseEvents(page)
    await seedRoster(page)
    await page.goto('/')
    await tab(page).click()
  })

  test('a row opens the dossier: the standing list, then every note', async ({ page }) => {
    await panel(page).getByRole('button', { name: /Open Sable's dossier/ }).click()

    const dossier = panel(page).getByRole('region', { name: /Sable — coaching dossier/ })
    await expect(dossier).toBeVisible()
    // The standing focus list, off data the roster already loaded.
    await expect(dossier.getByText('Ult economy first.')).toBeVisible()

    // Every note, fetched on demand: dated match keys read as days, replay
    // keys read as their code.
    await dossier.getByRole('button', { name: 'Read every note' }).click()
    await expect(dossier.getByText(/Hold the high ground/)).toBeVisible()
    await expect(dossier.getByText(/Aug 13/)).toBeVisible()
    await expect(dossier.getByText('A1B2C3')).toBeVisible()
  })

  test('"Review new codes" lands in the room already named', async ({ page }) => {
    // The session the door opens: same replay mock shape the codes spec uses.
    const state = { codes: [] as string[], handle: '', kind: 'player' }
    const view = () => ({
      player: { id: '', handle: state.handle, message: '', kind: state.kind },
      exported_at: '', session_date: '2026-08-25', match_count: state.codes.length,
      coach_name: 'Ordo', focus_items: [], notes: [], handle_from_bundle: false,
      source: 'replay',
    })
    await page.route('**/api/v1/coach/session/replay', async (route: Route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { codes: string[] }
      state.codes = body.codes
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(view()) })
    })
    await page.route('**/api/v1/coach/session/player', async (route: Route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { handle: string; kind?: string }
      state.handle = body.handle
      state.kind = body.kind ?? 'player'
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(view()) })
    })
    await page.route('**/api/v1/coach/session/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(state.codes.map((code) => ({
          match_key: `replay-${code}`, source_files: [], source: 'replay',
          source_types: {}, data: {}, annotation: { leavers: [], throwers: [], replay_code: code },
        }))),
      })
    })
    await page.route('**/api/v1/coach/session', async (route: Route) => {
      if (!state.codes.length) {
        await route.fulfill({ status: 404, contentType: 'application/problem+json', body: '{"title":"no session"}' })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(view()) })
    })

    await panel(page).getByRole('button', { name: /Open Sable's dossier/ }).click()
    await panel(page).getByRole('button', { name: 'Review new codes for Sable' }).click()

    // The codes modal opens, says who it is for, and the room needs no prompt.
    const dialog = page.getByRole('dialog', { name: 'Use a replay code' })
    await expect(dialog.getByText(/for Sable/)).toBeVisible()
    await dialog.getByRole('textbox', { name: 'Replay code' }).fill('A1B2C3')
    await dialog.getByRole('button', { name: 'Add' }).click()
    await page.getByRole('button', { name: 'Start review' }).click()

    await expect(page.getByRole('heading', { name: /Reviewing Sable/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Who is this?' })).toHaveCount(0)
  })
})
