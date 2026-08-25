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
  kind: string
  notes: Record<string, unknown>[]
  /** What the coach said they saw, per match key — the REAL server folds
   *  this into the corpus on refresh, and the folding is what once made
   *  the editor vanish. The mock must be as faithful. */
  contextByKey: Record<string, Record<string, string>>
}

function view(state: ReplaySessionState) {
  return {
    player: { id: '', handle: state.handle, message: '', kind: state.kind || 'player' },
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
    data: { ...(state.contextByKey[`replay-${code}`] ?? {}) },
    annotation: { leavers: [], throwers: [], replay_code: code },
  }))
}

/** A server that only knows how to run a code-only session. */
async function mockReplaySession(
  page: Page,
): Promise<{ opened: () => string[]; context: () => Record<string, string> | null; contextCalls: () => number }> {
  const state: ReplaySessionState = { codes: [], handle: '', kind: '', notes: [], contextByKey: {} }
  let opened: string[] = []
  let context: Record<string, string> | null = null
  let contextCalls = 0

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
    const body = JSON.parse(route.request().postData() ?? '{}') as { handle: string; kind?: string }
    state.handle = body.handle
    state.kind = body.kind ?? 'player'
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
    contextCalls += 1
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split('/matches/')[1]?.replace(/\/context$/, '') ?? '')
    state.contextByKey[key] = body
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(view(state)) })
  })
  await page.route('**/api/v1/coach/session/notes/**', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split('/notes/')[1] ?? '')
    const note = { note_id: 'n-1', match_key: key, updated_at: '2026-08-15T09:00:00Z', ...body }
    state.notes = [note]
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(note) })
  })
  return { opened: () => opened, context: () => context, contextCalls: () => contextCalls }
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

  // The editor is keyed on the frame's PROVENANCE (a codes session, a frame
  // with a replay code), never on whether the map happens to be blank right
  // now: keying on the data made the whole form vanish mid-task the moment
  // the map save round-tripped, taking Result, Hero and the date with it.
  // And a commit rides change/blur, never keystrokes — a mid-word pause
  // must not land "Ilio" on the server.
  test('the editor survives its own save, and typing alone saves nothing', async ({ page }) => {
    const mock = await mockReplaySession(page)
    await page.goto('/')
    await page.getByRole('tab', { name: /^Reviews/ }).click()
    await page.getByRole('button', { name: /Use a replay code/ }).click()
    await addCode(page, CODE_A)
    await page.getByRole('button', { name: 'Start review' }).click()
    await confirmPlayer(page, 'Sable')

    const observed = page.getByRole('region', { name: new RegExp(`What you saw in ${CODE_A}`) })
    const mapField = observed.getByRole('combobox', { name: 'Map' })

    // A mid-word pause, longer than the autosave debounce. Nothing may land.
    await mapField.pressSequentially('Ilio')
    // A fixed wait, on purpose: proving the ABSENCE of a request over the
    // debounce window is the one thing a poll cannot do.
    await page.waitForTimeout(700)
    expect(mock.contextCalls()).toBe(0)

    // Finish the word, then leave the field: NOW it commits.
    await mapField.pressSequentially('s')
    await observed.getByRole('combobox', { name: 'Result' }).selectOption('defeat')
    await expect.poll(() => mock.context()?.map).toBe('Ilios')
    await expect.poll(() => mock.context()?.result).toBe('defeat')

    // The save round-tripped and the frame now carries data.map — the
    // editor must still be standing, every field of it.
    await expect(observed).toBeVisible()
    const hero = observed.getByRole('combobox', { name: 'Hero' })
    await hero.fill('Ana')
    await hero.blur()
    await expect.poll(() => mock.context()?.hero).toBe('Ana')
    await expect.poll(() => mock.context()?.map).toBe('Ilios')
  })

  // The prompt offers the roster: a codes session about someone the coach
  // already knows should land on their existing file, not fork a second
  // row on a typo. The suggestions follow the fork's kind.
  test('the prompt suggests known names, filtered by the fork', async ({ page }) => {
    await page.route('**/api/v1/coach/players', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([
          { id: 2, handle: 'Sable', kind: 'player', note_count: 3 },
          { id: 3, handle: 'Wren', kind: 'player', note_count: 1 },
          { id: 1, handle: 'Sound Barrier', kind: 'team', note_count: 2 },
        ]),
      })
    })
    await mockReplaySession(page)
    await page.goto('/')
    await page.getByRole('tab', { name: /^Reviews/ }).click()
    await page.getByRole('button', { name: /Use a replay code/ }).click()
    await addCode(page, CODE_A)
    await page.getByRole('button', { name: 'Start review' }).click()

    const prompt = identityPrompt(page)
    await expect(prompt).toBeVisible()
    // Player fork: the two player names, not the team.
    await expect(prompt.locator('datalist option')).toHaveCount(2)
    await expect(prompt.locator('datalist option[value="Sable"]')).toHaveCount(1)
    await expect(prompt.locator('datalist option[value="Sound Barrier"]')).toHaveCount(0)
    // Team fork: only the team.
    await prompt.getByRole('radio', { name: 'A team' }).click()
    await expect(prompt.locator('datalist option')).toHaveCount(1)
    await expect(prompt.locator('datalist option[value="Sound Barrier"]')).toHaveCount(1)
  })

  // The identity prompt's fork: six characters can belong to a TEAM, and the
  // chosen shape is one shared review under the group's name — page-only.
  // The session then speaks team: the slip drops the notes-file button (the
  // file is a per-player artifact), the sheet reviews the team, and the
  // observed-context panel stops asking for a single hero.
  test('a team review: the fork, the voice, and the page-only slip', async ({ page }) => {
    await mockReplaySession(page)
    await page.goto('/')
    await page.getByRole('tab', { name: /^Reviews/ }).click()
    await page.getByRole('button', { name: /Use a replay code/ }).click()
    await addCode(page, CODE_A)
    await page.getByRole('button', { name: 'Start review' }).click()

    // The prompt asks WHO — and, for codes, WHAT.
    const prompt = identityPrompt(page)
    await expect(prompt).toBeVisible()
    await prompt.getByRole('radio', { name: 'A team' }).click()
    await prompt.getByRole('textbox', { name: 'Team name' }).fill('Sound Barrier')
    await prompt.getByRole('button', { name: 'Confirm' }).click()

    // Team voice on the slip: the group's name, no notes-file button, the
    // page leads and says who it is for.
    const slip = page.getByRole('region', { name: /Coaching session/ })
    await expect(slip.getByText('Sound Barrier')).toBeVisible()
    await expect(slip.getByRole('button', { name: /Export notes file/ })).toHaveCount(0)
    await expect(slip.getByRole('button', { name: /Save a web page — for the team/ })).toBeVisible()

    // The sheet reviews the team by name.
    await expect(page.getByRole('heading', { name: /Reviewing Sound Barrier/i })).toBeVisible()

    // The observed-context panel drops its single-hero field in team voice.
    const observed = page.getByRole('region', { name: new RegExp(`What you saw in ${CODE_A}`) })
    await expect(observed).toBeVisible()
    await expect(observed.getByRole('combobox', { name: 'Map' })).toBeVisible()
    await expect(observed.getByRole('combobox', { name: 'Hero' })).toHaveCount(0)
  })


  // The flow wears ONE name — the button's — through the dialog too, and a
  // codes session closes the doors into history that never arrived: the
  // masthead's "Step into X's: Matches / Trends…" over a corpus of blank
  // replay stubs renders empty views that read as the app being broken.
  test('the door wears one name, and no empty history is offered', async ({ page }) => {
    await mockReplaySession(page)
    await page.goto('/')
    await page.getByRole('tab', { name: /^Reviews/ }).click()
    await page.getByRole('button', { name: /Use a replay code/ }).click()
    await expect(page.getByRole('dialog', { name: 'Use a replay code' })).toBeVisible()

    await addCode(page, CODE_A)
    await page.getByRole('button', { name: 'Start review' }).click()
    await confirmPlayer(page, 'Sable')

    const strip = page.getByRole('navigation', { name: 'Coaching session' })
    await expect(strip.getByText(/No history came with these codes/)).toBeVisible()
    await expect(strip.getByRole('button', { name: 'Matches' })).toHaveCount(0)
    await expect(strip.getByRole('button', { name: 'Trends' })).toHaveCount(0)
  })

  // "Save a web page" hands the player the same document the notes file
  // carries — so it must count as handing something over. It used to leave
  // dirtySinceExport standing, and End then warned "notes not exported":
  // a false statement at the scariest moment of the flow.
  test('saving the one-page sheet counts as handing the notes over', async ({ page }) => {
    await mockReplaySession(page)
    await page.goto('/')
    await page.getByRole('tab', { name: /^Reviews/ }).click()
    await page.getByRole('button', { name: /Use a replay code/ }).click()
    await addCode(page, CODE_A)
    await page.getByRole('button', { name: 'Start review' }).click()
    await confirmPlayer(page, 'Sable')

    const editor = page.getByRole('textbox', { name: /note/i }).first()
    await editor.click()
    await page.keyboard.type('Hold the high ground until their dive commits.')
    await editor.blur()

    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: /Save a web page/ }).first().click()
    await downloading
    await expect(page.getByText(/Notes saved to/).first()).toBeVisible()

    await page.getByRole('button', { name: /End session/ }).first().click()
    await expect(page.getByRole('button', { name: /End anyway/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Use a replay code/ })).toBeVisible()
  })
})
