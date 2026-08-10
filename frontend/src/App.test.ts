import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within, fireEvent } from '@testing-library/vue'
import { nextTick } from 'vue'
import type { MatchRecord } from '@/api'
import { fireBackendEvent, flushPromises, mockedApi, renderApp } from '@/test-utils'

// Smoke + behavior tests for App.vue. These do not try to cover every
// branch of the ~4500-line SFC — the helpers and composables under it
// have their own dedicated test files. The goal here is to verify
// that App wires those pieces together correctly: API → composables
// → DOM. Coverage rolls up via `make cover-frontend`.
//
// Interactions use TL fireEvent (matching the original trigger()
// dispatch — user-event's awaited chains interleave with the query
// notify re-renders on this store-backed surface).

afterEach(async () => {
  // Settle in-flight lazy-view imports inside the test env — a loader
  // resolving after teardown throws EnvironmentTeardownError as an
  // unhandled rejection (CI's slow coverage pass loses this race).
  await vi.dynamicImportSettled()
  vi.restoreAllMocks()
  vi.resetModules()
})

const tab = (name: RegExp) => screen.getByRole('tab', { name })
const panel = (name: RegExp) => screen.queryByRole('tabpanel', { name })

// ── Structural helpers ───────────────────────────────────────────────
// The masthead scoreboard's pulse class + W/L/D cells, the background
// container's inert state, and the source-order first-focusable pin
// have no accessible-name equivalent — they are selected directly.
/* eslint-disable testing-library/no-node-access -- pulse/inert/source-order pins have no accessible-query equivalent */
const scoreboard = () => document.querySelector('.scoreboard')
const scoreNums  = () => [...document.querySelectorAll('.scoreboard .score-num')]
const container  = () => document.querySelector('.container')
const modalBox   = () => document.querySelector('.modal-box')
const modalButtons = () => [...document.querySelectorAll('.modal-actions button')]
const skipLink   = () => document.querySelector('a.skip-link')
/* eslint-enable testing-library/no-node-access */

// The tesseract-gate banner announces itself as role="alert" — the only
// live alert on the page in these fixtures.
const systemAlert = () => screen.queryByRole('alert')

describe('App.vue', () => {
  // 15s budget: the first App render pays the whole SFC tree's
  // import + compile cost, and under the pre-push battery the box
  // runs coverage instrumentation concurrently with the playwright
  // harness build — the default 5s flaked a push on pure load. A
  // real render hang still fails; it just isn't confused with a
  // saturated machine.
  it('mounts without throwing and shows the RECALL masthead', { timeout: 15_000 }, async () => {
    await renderApp()
    // Masthead text uses the OW Wordmark font on "RECALL" (split
    // across letter spans inside the brandmark link, so assert on the
    // link's full content).
    expect(screen.getByRole('link', { name: /GitHub/ })).toHaveTextContent(/RECALL/)
  })

  it('defaults to the Matches tab on initial load', async () => {
    await renderApp()
    // Active tab is reflected in the aria-selected attribute, which the
    // tablist semantics make easy to query without coupling to CSS class
    // names that could shift with theme work.
    expect(tab(/Matches/)).toHaveAttribute('aria-selected', 'true')
    expect(tab(/Settings/)).toHaveAttribute('aria-selected', 'false')
  })

  it('calls GetMatchResults once on mount via the load() Promise.all', async () => {
    // mockedApi() returns the exact mock object App's stores bound their api
    // functions from, so the call counts we inspect are the ones load() drove
    // (re-importing '@/api' can resolve to a different instance under low fork
    // counts — see renderApp).
    await renderApp({
      records: [
        // Minimal valid MatchRecord — only the fields the helpers actually read.
        { match_key: 'match-2026-05-10T21-29-28', source_files: ['a.png'], data: {
          map: 'rialto', date: '2026-05-10', finished_at: '21:29', result: 'victory',
        } },
      ],
    })
    const api = mockedApi()
    expect(api.GetMatchResults).toHaveBeenCalledTimes(1)
    expect(api.GetTesseractStatus).toHaveBeenCalledTimes(1)
  })

  it('switching tabs swaps the visible view panel', async () => {
    await renderApp()
    // Matches view is rendered by default.
    expect(panel(/Matches/)).toBeInTheDocument()

    // Click the Settings tab; the matches panel disappears, the
    // settings panel appears. flushPromises waits for the async view
    // component (defineAsyncComponent) to resolve its dynamic import.
    await fireEvent.click(tab(/Settings/))
    await flushPromises()
    expect(panel(/Settings/)).toBeInTheDocument()
    expect(panel(/Matches/)).not.toBeInTheDocument()

    // And back: clicking matches restores it.
    await fireEvent.click(tab(/Matches/))
    await flushPromises()
    expect(panel(/Matches/)).toBeInTheDocument()
    expect(panel(/Settings/)).not.toBeInTheDocument()
  })

  // Note: UNKNOWN DATE bucket rendering is covered directly in
  // MatchesView.test.ts (it can pin the includeUndated prop). Mounting
  // App.vue end-to-end with localStorage-seeded preferences is
  // brittle in happy-dom + dynamic import — keep that coverage at
  // the component-test layer where the seam is explicit.

  it('renders the brandmark as a link to the GitHub repo', async () => {
    await renderApp()
    const brand = screen.getByRole('link', { name: /GitHub/ })
    expect(brand).toHaveAttribute('href', 'https://github.com/sound-barrier/recall')
    expect(brand).toHaveAttribute('target', '_blank')
    expect(brand).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('clicking the brandmark routes through OpenURL (so Wails opens the system browser)', async () => {
    await renderApp()
    const api = mockedApi()
    await fireEvent.click(screen.getByRole('link', { name: /GitHub/ }))
    expect(api.OpenURL).toHaveBeenCalledWith('https://github.com/sound-barrier/recall')
  })
})

describe('App.vue — scoreboard pulse on watcher refresh', () => {
  // Watcher-driven (or manual) parse fires a parse-complete event. The
  // App's handler calls load(); when load sees the records count grew,
  // it flashes a pulse class on the scoreboard so the user notices.
  it('adds .pulse to the scoreboard when records grow on parse-complete', async () => {
    const initial: MatchRecord[] = [
      { match_key: 'match-2026-05-10T21-29-28', source_files: ['a.png'], data: {
        map: 'rialto', date: '2026-05-10', finished_at: '21:29', result: 'victory',
      } },
    ]
    await renderApp({ records: initial })
    // eslint-disable-next-line no-restricted-syntax -- the pulse flash is a purely visual attention cue with no ARIA state
    expect(scoreboard()).not.toHaveClass('pulse')

    // Re-mock GetMatchResults so the next load() returns one more record.
    const api = mockedApi()
    const grown: MatchRecord[] = [
      ...initial,
      { match_key: 'match-2026-05-10T22-14-02', source_files: ['b.png'], data: {
        map: 'aatlis', date: '2026-05-10', finished_at: '22:14', result: 'defeat',
      } },
    ]
    ;(api.GetMatchResults as ReturnType<typeof vi.fn>).mockResolvedValueOnce(grown)

    // Fire the watcher event the way the runtime would. The handler
    // re-runs load() asynchronously, so flushPromises lets the
    // Promise.all + the post-load reactive update settle.
    expect(fireBackendEvent('parse-complete')).toBe(true)
    await flushPromises()
    // eslint-disable-next-line no-restricted-syntax -- the pulse flash is a purely visual attention cue with no ARIA state
    expect(scoreboard()).toHaveClass('pulse')
  })

  it('does NOT pulse when records count is unchanged on parse-complete', async () => {
    const seed: MatchRecord[] = [
      { match_key: 'match-2026-05-10T21-29-28', source_files: ['a.png'], data: {
        map: 'rialto', date: '2026-05-10', finished_at: '21:29', result: 'victory',
      } },
    ]
    await renderApp({ records: seed })
    expect(fireBackendEvent('parse-complete')).toBe(true)
    await flushPromises()
    // eslint-disable-next-line no-restricted-syntax -- the pulse flash is a purely visual attention cue with no ARIA state
    expect(scoreboard()).not.toHaveClass('pulse')
  })
})

describe('App.vue — masthead scoreboard W/L/D consistency', () => {
  // The masthead scoreboard and the MatchesView "Record" KPI tile
  // both count wins/losses/draws across the same set of records.
  // Before the consistency fix, the masthead used the LEGACY
  // useMatchFilters pipeline (which silently dropped undated rows)
  // while MatchesView's Record tile used useMatchesNarrow.narrowed
  // (which keeps undated rows in by default). A live match whose
  // result was inferred from a rank-screen SR change but with no
  // SUMMARY-supplied date/finished_at would show up in the Record
  // tile but not in the masthead — surfacing the same data as two
  // different W/L/D readings to the user.
  it('counts undated rows the same way as the Matches view Record tile', async () => {
    const records: MatchRecord[] = [
      // Dated victory — both pipelines count this.
      { match_key: 'match-2026-05-10T21-29-28', source_files: ['a.png'], data: {
        map: 'aatlis', hero: 'lucio', date: '2026-05-10', finished_at: '21:29', result: 'victory',
      } },
      // Dated defeat — both pipelines count this.
      { match_key: 'match-2026-05-10T21-49-34', source_files: ['b.png'], data: {
        map: 'rialto', hero: 'wuyang', date: '2026-05-10', finished_at: '21:49', result: 'defeat',
      } },
      // UNDATED victory (rank-inferred result with no SUMMARY) —
      // the live-DB Suravasa case. Legacy pipeline drops it; the
      // Record tile counts it; masthead now must count it too.
      { match_key: 'match-2026-05-10T22-21-11', source_files: ['c.png'], data: {
        map: 'suravasa', hero: 'lucio', result: 'victory',
      } },
    ]
    await renderApp({ records })
    const cells = scoreNums()
    expect(cells).toHaveLength(3)
    expect(cells[0]).toHaveTextContent(/^2$/) // wins
    expect(cells[1]).toHaveTextContent(/^1$/) // losses
    expect(cells[2]).toHaveTextContent(/^0$/) // draws
  })
})

describe('App.vue — tablist keyboard navigation', () => {
  // WAI-ARIA tab pattern with automatic activation: ArrowLeft/Right wrap
  // through the tabs, Home/End jump to either end, and each keypress
  // both moves focus AND switches the visible view. The keydown
  // dispatches on the tablist; the nav's listener sees it via bubbling.
  it('ArrowRight from Settings activates Ingest', async () => {
    await renderApp()
    await fireEvent.click(tab(/Settings/))
    await fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' })
    expect(tab(/Parse/)).toHaveAttribute('aria-selected', 'true')
  })

  it('ArrowLeft from Settings wraps to the Elo Calculator', async () => {
    await renderApp()
    await fireEvent.click(tab(/Settings/))
    await fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' })
    expect(tab(/Elo/)).toHaveAttribute('aria-selected', 'true')
    // Settle the lazy Elo view's dynamic import inside the test so its setup
    // runs while the provider is still mounted; a mount that lands post-teardown
    // makes useEloCalc's inject-guard throw as an unhandled rejection. Unlike a
    // vi.waitFor window, dynamicImportSettled has no timeout to lose under CI's
    // slow coverage run — it resolves exactly when the import finishes.
    await vi.dynamicImportSettled()
    await flushPromises()
    expect(panel(/Elo/)).toBeInTheDocument()
  })

  it('Home jumps to the first tab (Settings)', async () => {
    await renderApp()
    // Default is Matches; Home should jump to Settings.
    await fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Home' })
    expect(tab(/Settings/)).toHaveAttribute('aria-selected', 'true')
  })

  it('End jumps to the last tab (Elo Calculator)', async () => {
    await renderApp()
    await fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' })
    expect(tab(/Elo/)).toHaveAttribute('aria-selected', 'true')
    // Settle the lazy Elo view within the test (see the ArrowLeft case above).
    await vi.dynamicImportSettled()
    await flushPromises()
    expect(panel(/Elo/)).toBeInTheDocument()
  })

  it('typing into a tab without an arrow key does not change selection', async () => {
    await renderApp()
    await fireEvent.keyDown(screen.getByRole('tablist'), { key: 'a' })
    expect(tab(/Matches/)).toHaveAttribute('aria-selected', 'true')
  })
})

describe('App.vue — landmarks and skip-link', () => {
  it('renders a skip-link as the first focusable, pointing at #main-content', async () => {
    await renderApp()
    const skip = skipLink()
    expect(skip).toBeInTheDocument()
    expect(skip).toHaveAttribute('href', '#main-content')
    // First <a>/button/input/etc in source order — keyboard users land
    // here on Tab from outside the page.
    // eslint-disable-next-line testing-library/no-node-access -- pins SOURCE-ORDER first-focusable, which no accessible query expresses
    const firstFocusable = document.body.querySelector('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
    expect(firstFocusable).toBe(skip)
  })

  it('wraps the active view panel in a <main id="main-content">', async () => {
    await renderApp()
    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('id', 'main-content')
    // tabindex="-1" so the skip-link can move focus to it without
    // putting <main> in the natural tab order.
    expect(main).toHaveAttribute('tabindex', '-1')
    // The active panel (matches by default) is rendered inside it.
    expect(within(main).getByRole('tabpanel', { name: /Matches/ })).toBeInTheDocument()
  })

  it('skip-link click focuses the <main> landmark', async () => {
    await renderApp()
    await fireEvent.click(skipLink()!)
    // eslint-disable-next-line testing-library/no-node-access -- focus movement IS the behavior under test; TL has no focus query
    expect((document.activeElement as HTMLElement | null)?.id).toBe('main-content')
  })
})

describe('App.vue — unsupported-tesseract modal a11y', () => {
  async function openUnsupportedModal() {
    // Tesseract is detected but reports an unsupported version (e.g. 4.x).
    // Clicking Run Parse opens the confirmation modal instead of parsing.
    await renderApp({
      screenshotsDir: '/home/me/shots',
      newScreenshotCount: 3,
      tesseract: { found: true, supported: false, version: '4.1.1' },
    })
    await fireEvent.click(tab(/Parse/))
    // IngestView is loaded via defineAsyncComponent, so the v-if switch
    // resolves the dynamic import in a microtask. flushPromises waits
    // for that AND the post-import re-render; nextTick alone is not
    // enough.
    await flushPromises()
    await fireEvent.click(screen.getByTestId('run-parse-btn'))
    await nextTick()
  }

  it('opening the modal moves focus to the first focusable (Cancel)', async () => {
    await openUnsupportedModal()
    expect(modalBox()).toBeInTheDocument()
    // Cancel is the first <button> inside .modal-actions by markup order,
    // chosen specifically so destructive primary actions (Continue
    // Anyway) never receive default focus.
    const cancel = modalButtons()[0]!
    // eslint-disable-next-line testing-library/no-node-access -- initial-focus placement IS the behavior under test; TL has no focus query
    expect(document.activeElement).toBe(cancel)
  })

  it('Escape on document closes the modal', async () => {
    await openUnsupportedModal()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(modalBox()).not.toBeInTheDocument()
  })

  it('background container is marked inert and aria-hidden while open', async () => {
    await openUnsupportedModal()
    // Vue serializes boolean inert as the attribute being present.
    expect(container()).toHaveAttribute('inert')
    expect(container()).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('App.vue — startup-error modal (item 8)', () => {
  it('stays hidden when GetStartupError returns an empty string', async () => {
    await renderApp({ records: [] })
    expect(screen.queryByTestId('startup-error-modal')).not.toBeInTheDocument()
  })

  it('renders the captured message when GetStartupError returns non-empty', async () => {
    await renderApp({
      records: [],
      startupError: 'startup: profile manager init: permission denied',
    })
    const modal = screen.getByTestId('startup-error-modal')
    expect(modal).toHaveAttribute('role', 'alertdialog')
    expect(modal).toHaveTextContent('startup: profile manager init: permission denied')
  })

  it('marks the background container inert + aria-hidden while open', async () => {
    await renderApp({
      records: [],
      startupError: 'startup: open SQLite /home/u/db: read-only filesystem',
    })
    expect(container()).toHaveAttribute('inert')
    expect(container()).toHaveAttribute('aria-hidden', 'true')
  })

  it('has no Close / Cancel button — restart is the only recovery', async () => {
    await renderApp({
      records: [],
      startupError: 'startup: create db directory /etc/recall: permission denied',
    })
    const modal = screen.getByTestId('startup-error-modal')
    // The unsupported-tesseract modal has Cancel + Continue Anyway; the
    // startup-error variant intentionally has none. A future PR that
    // adds a "Quit" or "Retry" button can update this expectation.
    expect(within(modal).queryAllByRole('button')).toHaveLength(0)
  })
})

// ── First-run modal gating ───────────────────────────────────────────
// The modal renders only when `firstRunPending && !tourActive`.
// Both signals are seeded from localStorage; renderApp's defaults
// suppress both, so each test below clears the relevant seed first.
describe('App.vue — first-run modal gating (item 6 coverage lift)', () => {
  it('does NOT render the first-run modal when the localStorage ack is set', async () => {
    // renderApp defaults to seeding the ack to "true"; the modal must
    // stay hidden on the first paint.
    await renderApp({ records: [] })
    expect(screen.queryByRole('dialog', { name: /main account name/i })).not.toBeInTheDocument()
  })

  it('keeps the first-run modal hidden across a parse-complete fire', async () => {
    // Defense-in-depth: a runtime event must not flip an
    // already-acknowledged first-run state back on.
    await renderApp({ records: [] })
    expect(fireBackendEvent('parse-complete')).toBe(true)
    await flushPromises()
    expect(screen.queryByRole('dialog', { name: /main account name/i })).not.toBeInTheDocument()
  })
})

// ── Tab swap preserves Matches list state ────────────────────────────
// Switching from Matches → Settings → Matches must NOT re-fetch
// /api/v1/matches or scramble the loaded records. The view re-renders
// against the same in-memory `records` ref.
describe('App.vue — tab swap preserves Matches state', () => {
  it('keeps the same record set after Matches → Settings → Matches', async () => {
    const records: MatchRecord[] = [
      { match_key: 'match-2026-05-10T21-29-28', source_files: ['a.png'], data: {
        map: 'rialto', date: '2026-05-10', finished_at: '21:29', result: 'victory',
      } },
    ]
    await renderApp({ records })
    await flushPromises()

    // Initial render fired one GetMatchResults.
    const api = mockedApi()
    const mockFn = api.GetMatchResults as ReturnType<typeof vi.fn>
    const initialCalls = mockFn.mock.calls.length
    expect(initialCalls).toBeGreaterThanOrEqual(1)

    // Switch to Settings and back to Matches.
    await fireEvent.click(tab(/Settings/))
    await flushPromises()
    await fireEvent.click(tab(/Matches/))
    await flushPromises()

    // No additional fetch on tab swap — App.vue's `records` ref is
    // the source of truth and surviving the round-trip is the contract.
    expect(mockFn.mock.calls.length).toBe(initialCalls)
  })
})

// ── Tesseract-ready gate blocks parse ────────────────────────────────
// When tesseract is missing or unsupported, the Parse button is
// disabled and the System Alert banner renders. Pinned here so a
// rewire of the gate doesn't silently let parse() run against an
// unconfigured OCR engine.
describe('App.vue — tesseract gate', () => {
  it('renders the System Alert banner when tesseract is not found', async () => {
    await renderApp({
      records: [],
      tesseract: { found: false, supported: false, error: 'tesseract not on PATH' },
    })
    expect(systemAlert()).toBeInTheDocument()
  })

  it('renders no System Alert banner when tesseract is supported', async () => {
    await renderApp({ records: [], tesseract: { found: true, supported: true } })
    expect(systemAlert()).toBeNull()
  })
})
