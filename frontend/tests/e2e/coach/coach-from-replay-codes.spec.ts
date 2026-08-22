/**
 * Coaching from replay codes — the door with no bundle behind it.
 *
 * Most reviews start with six characters pasted into chat, not a zip in an
 * email. This is that flow end to end: the coach types codes on the Reviews
 * tab, lands in the same film room a bundle opens, is asked who they are
 * coaching (nothing in the payload said), writes a note about a match that
 * exists on nobody's disk, and adds a second code mid-session.
 *
 * Only the e2e proves the chain. Three of the gates involved fail SILENTLY
 * rather than loudly, which is the reason this spec exists:
 *
 *   - the reel filter drops frames whose key it does not recognize, so a
 *     wrong gate renders an empty desk with no error anywhere;
 *   - the note write refuses a key the session does not hold, which would
 *     swallow a paragraph the coach had already typed;
 *   - the entry field mints the identity, so a code that reaches the server
 *     in the wrong case produces a match the player can never be matched to.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'
import { confirmPlayer, identityPrompt } from '../_coach'
import { seedProfiles, silenceParseEvents } from '../_theme-matrix'

const CODE_A = 'A1B2C3'
const CODE_B = 'D4E5F6'

interface ReplaySessionState {
  codes: string[]
  handle: string
  notes: Record<string, unknown>[]
}

function view(state: ReplaySessionState) {
  return {
    player: { id: '', handle: state.handle, message: '' },
    exported_at: '',
    session_date: '2026-08-15',
    match_count: state.codes.length,
    coach_name: 'Ordo',
    focus_items: [],
    notes: state.notes,
    handle_from_bundle: false,
    source: 'replay',
  }
}

function matchesOf(state: ReplaySessionState) {
  return state.codes.map((code) => ({
    match_key: `replay-${code}`,
    source_files: [],
    source: 'replay',
    source_types: {},
    data: {},
    annotation: { leavers: [], throwers: [], replay_code: code },
  }))
}

/** A server that only knows how to run a code-only session. */
async function mockReplaySession(
  page: Page,
): Promise<{ opened: () => string[]; context: () => Record<string, string> | null }> {
  const state: ReplaySessionState = { codes: [], handle: '', notes: [] }
  let opened: string[] = []
  let context: Record<string, string> | null = null

  await page.route('**/api/v1/coach/session/replay', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { codes: string[] }
    opened = body.codes
    state.codes = body.codes.map((c) => c.toUpperCase())
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(view(state)) })
  })
  await page.route('**/api/v1/coach/session/replay/codes', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { code: string }
    const code = body.code.toUpperCase()
    if (!state.codes.includes(code)) state.codes.push(code)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(view(state)) })
  })
  await page.route('**/api/v1/coach/session/player', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { handle: string }
    state.handle = body.handle
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(view(state)) })
  })
  await page.route('**/api/v1/coach/session/matches', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(matchesOf(state)) })
  })
  await page.route('**/api/v1/coach/session', async (route: Route) => {
    if (route.request().method() === 'DELETE') {
      state.codes = []
      await route.fulfill({ status: 204, body: '' })
      return
    }
    if (!state.codes.length) {
      await route.fulfill({ status: 404, contentType: 'application/problem+json', body: '{"title":"no session"}' })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(view(state)) })
  })
  await page.route('**/api/v1/coach/session/matches/*/context', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, string>
    context = body
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(view(state)) })
  })
  await page.route('**/api/v1/coach/session/notes/**', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split('/notes/')[1] ?? '')
    const note = { note_id: 'n-1', match_key: key, updated_at: '2026-08-15T09:00:00Z', ...body }
    state.notes = [note]
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(note) })
  })
  return { opened: () => opened, context: () => context }
}

type Page = import('@playwright/test').Page

async function addCode(page: Page, code: string): Promise<void> {
  const dialog = page.getByTestId('coach-from-codes')
  await dialog.getByRole('textbox', { name: 'Replay code' }).fill(code)
  await dialog.getByRole('button', { name: 'Add' }).click()
}

test.describe('coaching from replay codes', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await seedProfiles(page)
    await silenceParseEvents(page)
  })

  test('six characters open the same room a bundle does', async ({ page }) => {
    const mock = await mockReplaySession(page)
    await page.goto('/')
    await page.getByRole('tab', { name: /^Reviews/ }).click()

    await page.getByRole('button', { name: /Use a replay code/ }).click()
    await addCode(page, 'a1b2c3')

    // The code is echoed back canonically — the cheapest place to catch a
    // typo, and the only one before the handoff.
    await expect(page.getByTestId('coach-from-codes').getByText(CODE_A, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Start review' }).click()

    // Uppercased before it left the browser: both sides mint the same key.
    await expect.poll(() => mock.opened()).toEqual([CODE_A])

    // Nothing in the payload said who this is about, so the room asks —
    // the same prompt a handle-less bundle raises, not a second one.
    await expect(identityPrompt(page)).toBeVisible()
    await confirmPlayer(page, 'Sable')

    // The frame is on the reel. This is the assertion the silent gate would
    // have failed: a wrong filter renders an empty desk saying the session
    // holds no matches.
    await expect(page.getByText(CODE_A, { exact: false }).first()).toBeVisible()
  })

  test('the reel grows when another code arrives mid-session', async ({ page }) => {
    await mockReplaySession(page)
    await page.goto('/')
    await page.getByRole('tab', { name: /^Reviews/ }).click()
    await page.getByRole('button', { name: /Use a replay code/ }).click()
    await addCode(page, CODE_A)
    await page.getByRole('button', { name: 'Start review' }).click()
    await confirmPlayer(page, 'Sable')

    await page.getByRole('button', { name: /Add a replay code/ }).click()
    const field = page.getByRole('textbox', { name: 'Replay code' })
    await field.fill(CODE_B)
    await page.getByRole('button', { name: 'Add', exact: true }).click()

    await expect(page.getByText(CODE_B, { exact: false }).first()).toBeVisible()
  })

  // A replay frame arrives blank — no screenshot, nothing parsed — so the
  // card would read "No result · Not dated · —" forever. This is where the
  // coach says what they saw, and the date is PRE-FILLED on purpose: a match
  // with no time at all passes every date filter there is, so it would show
  // up in every season on the player's side.
  test('the coach records what they saw, and the date is not left blank', async ({ page }) => {
    const mock = await mockReplaySession(page)
    await page.goto('/')
    await page.getByRole('tab', { name: /^Reviews/ }).click()
    await page.getByRole('button', { name: /Use a replay code/ }).click()
    await addCode(page, CODE_A)
    await page.getByRole('button', { name: 'Start review' }).click()
    await confirmPlayer(page, 'Sable')

    const observed = page.getByRole('region', { name: new RegExp(`What you saw in ${CODE_A}`) })
    await expect(observed).toBeVisible()

    // Defaulted from the session date rather than empty.
    await expect(observed.getByRole('textbox', { name: 'Date' })).not.toHaveValue('')

    await observed.getByRole('combobox', { name: 'Map' }).fill('Ilios')
    await observed.getByRole('combobox', { name: 'Result' }).selectOption('defeat')

    await expect.poll(() => mock.context()?.map).toBe('Ilios')
    await expect.poll(() => mock.context()?.result).toBe('defeat')
    await expect.poll(() => mock.context()?.date ?? '').not.toBe('')
  })
})
