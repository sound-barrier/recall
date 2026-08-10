import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'

import OnboardingTour from '@/components/shared/OnboardingTour.vue'
import { ONBOARDING_STEPS } from '@/composables/shared/useOnboardingTour'
import { ONBOARDING_COMPLETED_KEY, ONBOARDING_RESUME_KEY } from '@/composables/shared/storageKeys'
import { useUiStore } from '@/stores/ui'

// The tour reads the ui store, which instantiates the app + matches
// stores and with them the boot query observers. None of that is under
// test here, so neutralize the loaders rather than letting a dozen
// unmocked fetches fire (the MatchesView.test precedent).
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  GetVersion:                        vi.fn(async () => '0.0.0-test'),
  GetDataLocation:                   vi.fn(async () => ({ path: '', profile: 'main' })),
  GetMatchResults:                   vi.fn(async () => []),
  GetNewScreenshotCount:             vi.fn(async () => 0),
  GetFailedFiles:                    vi.fn(async () => []),
  GetAutoBackupStatus:               vi.fn(async () => ({ interval_days: 0 })),
  GetScreenshotsFolderCandidates:    vi.fn(async () => []),
  GetScreenshotsDir:                 vi.fn(async () => ''),
  GetWatchEnabled:                   vi.fn(async () => false),
  GetExitOnClose:                    vi.fn(async () => false),
  GetTesseractStatus:                vi.fn(async () => ({ installed: true, path: '/usr/bin/tesseract', version: '5' })),
  GetProfiles:                       vi.fn(async () => ({ active: 'main', profiles: ['main'], immutable: [] })),
}))

// This file imports the stores, which statically import '@/api'; drop the
// module registry afterwards so the cached store + its real '@/api'
// binding can't leak into a later renderApp test (see
// reference_store_api_mock_isolation).
afterAll(() => {
  vi.resetModules()
})

// OnboardingTour is the tour's CONTROLLER shell: it owns the keyboard
// contract, the open/close transitions that install and drop the document
// listener, the "replay" bridge from Settings, and the emits App.vue turns
// into view switches. The spotlight geometry underneath it is Playwright's
// job (see vitest.config.ts) — everything asserted here is a decision the
// shell makes from step state.

const STEP_COUNT = ONBOARDING_STEPS.length
const LAST_INDEX = STEP_COUNT - 1
const headingOf = (i: number) => ONBOARDING_STEPS[i]!.heading

// The tour decides whether to open inside onMounted (localStorage gate +
// resume key), so the first paint happens a tick after render().
async function renderTour(seed: (index: number) => Promise<void> = () => Promise.resolve()) {
  setActivePinia(createPinia())
  const seedAndSwitchToTest = vi.fn(seed)
  const view = render(OnboardingTour, { props: { seedAndSwitchToTest } })
  await new Promise(resolve => setTimeout(resolve, 0))
  return { ...view, seedAndSwitchToTest }
}

// Every navigation key is handled on a capture-phase document listener, so
// the test drives them the same way the browser does.
const pressKey = (key: string) =>
  fireEvent.keyDown(document, { key })

const nextBtn = () => screen.getByRole('button', { name: /^Next/ })
const heading = () => screen.getByRole('heading', { level: 2 })

// happy-dom exposes no global localStorage; stub an in-memory one
// (mirrors useTableSort.test.ts) so the completed / resume keys the tour
// gates on actually round-trip.
let storage: Record<string, string>
beforeEach(() => {
  storage = {}
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = value },
    removeItem: (key: string) => { delete storage[key] },
    clear: () => { storage = {} },
  })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  // The callout's positioning engine polls animation frames after every
  // step change; let the in-flight passes drain inside the test env.
  await new Promise(resolve => setTimeout(resolve, 0))
})

describe('OnboardingTour — first-launch gate', () => {
  it('opens on mount for a user who has never completed it', async () => {
    await renderTour()
    // Overlay + callout are both dialogs labeled by the step heading; the
    // OUTER one is the modal that traps the app behind it.
    const [overlay] = screen.getAllByRole('dialog', { name: headingOf(0) })
    expect(overlay).toHaveAttribute('aria-modal', 'true')
    expect(heading()).toHaveTextContent(headingOf(0))
  })

  it('stays closed once the completed flag is set', async () => {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true')
    await renderTour()
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
  })

  it('reopens at the parked step after the seed+switch reload, consuming the resume key', async () => {
    // The "Explore with real data" step reloads the SPA; the tour has to
    // come back on the Done step rather than at the beginning.
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true')
    localStorage.setItem(ONBOARDING_RESUME_KEY, String(LAST_INDEX))
    await renderTour()

    expect(heading()).toHaveTextContent(headingOf(LAST_INDEX))
    // One-shot: a later reload must not reopen the tour again.
    expect(localStorage.getItem(ONBOARDING_RESUME_KEY)).toBeNull()
  })

  it('ignores a resume index outside the step list', async () => {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true')
    localStorage.setItem(ONBOARDING_RESUME_KEY, String(STEP_COUNT + 5))
    await renderTour()
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
  })
})

describe('OnboardingTour — step machine', () => {
  it('drives the underlying app to the first step that names a view', async () => {
    const { emitted } = await renderTour()
    // Step 1 (Welcome) has no view; step 2 does. Advancing must tell
    // App.vue to switch tabs or the spotlight rings an unmounted panel.
    await fireEvent.click(nextBtn())
    await fireEvent.click(nextBtn())
    expect(emitted('navigate')?.at(-1)).toEqual([ONBOARDING_STEPS[2]!.view])
  })

  it('advances and retreats through the counter, clamping at the first step', async () => {
    await renderTour()
    expect(screen.getByText(`01 / ${String(STEP_COUNT).padStart(2, '0')}`)).toBeInTheDocument()

    await fireEvent.click(nextBtn())
    expect(heading()).toHaveTextContent(headingOf(1))

    await fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(heading()).toHaveTextContent(headingOf(0))
    // Previous is disabled on step 1 — the tour cannot walk off its front.
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  })

  it('jumps straight to a step from its pip', async () => {
    await renderTour()
    await fireEvent.click(screen.getByRole('button', { name: `Go to step 4 of ${STEP_COUNT}` }))
    expect(heading()).toHaveTextContent(headingOf(3))
  })

  it('announces tour-active on open and flips it back on finish', async () => {
    // App.vue swaps the live records for the demo corpus off this flag;
    // a missed `false` would strand the user in demo data.
    const { emitted } = await renderTour()
    expect(emitted('active-change')).toEqual([[true]])

    await pressKey('Escape')
    expect(emitted('active-change')).toEqual([[true], [false]])
  })
})

describe('OnboardingTour — keyboard contract', () => {
  it('walks forward with ArrowRight / l and back with ArrowLeft / h', async () => {
    await renderTour()
    await pressKey('ArrowRight')
    expect(heading()).toHaveTextContent(headingOf(1))
    await pressKey('l')
    expect(heading()).toHaveTextContent(headingOf(2))
    await pressKey('ArrowLeft')
    expect(heading()).toHaveTextContent(headingOf(1))
    await pressKey('h')
    expect(heading()).toHaveTextContent(headingOf(0))
  })

  it('Escape dismisses and persists the completed flag WITHOUT seeding a profile', async () => {
    // Escape is a pure dismiss: reloading into a freshly seeded sample
    // profile because someone hit Esc would be a nasty surprise.
    const { seedAndSwitchToTest } = await renderTour()
    await pressKey('Escape')

    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
    expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBe('true')
    expect(seedAndSwitchToTest).not.toHaveBeenCalled()
  })

  it('does NOT hijack h / l while the user is typing in a field', async () => {
    await renderTour()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    await fireEvent.keyDown(input, { key: 'l' })
    await fireEvent.keyDown(input, { key: 'h' })

    // Still on the Welcome step — a search box beneath the tour has to
    // stay typeable.
    expect(heading()).toHaveTextContent(headingOf(0))
    input.remove()
  })

  it('ignores keys once the tour has closed', async () => {
    await renderTour()
    await pressKey('Escape')
    await pressKey('ArrowRight')
    // The document listener is dropped on close; a surviving one would
    // absorb site-wide arrow keys forever.
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
  })
})

describe('OnboardingTour — exits that seed the sample profile', () => {
  it('Skip seeds the sample profile and parks the Done step for the reload', async () => {
    const { seedAndSwitchToTest } = await renderTour()
    await fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }))
    expect(seedAndSwitchToTest).toHaveBeenCalledWith(LAST_INDEX)
  })

  it('Skip still closes the tour when seeding fails', async () => {
    // No seed, no data — but the user asked to leave, so trapping them in
    // the tour is the one unacceptable outcome.
    const { seedAndSwitchToTest } = await renderTour(() => Promise.reject(new Error('no disk')))
    await fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(seedAndSwitchToTest).toHaveBeenCalled()
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
    expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBe('true')
  })

  it('Done on the last step finishes without seeding again', async () => {
    localStorage.setItem(ONBOARDING_RESUME_KEY, String(LAST_INDEX))
    const { seedAndSwitchToTest, emitted } = await renderTour()

    await fireEvent.click(screen.getByRole('button', { name: /^Done/ }))
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
    expect(seedAndSwitchToTest).not.toHaveBeenCalled()
    expect(emitted('active-change')?.at(-1)).toEqual([false])
  })
})

describe('OnboardingTour — replay from Settings', () => {
  it('reopens at step one when the ui store raises a replay request', async () => {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true')
    await renderTour()
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()

    const ui = useUiStore()
    ui.requestTourReplay()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(heading()).toHaveTextContent(headingOf(0))
    // Cleared on consumption so a SECOND Replay click works too.
    expect(ui.tourReplayRequested).toBe(false)
  })

  it('honors a second replay request after the tour was closed again', async () => {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true')
    await renderTour()
    const ui = useUiStore()

    ui.requestTourReplay()
    await new Promise(resolve => setTimeout(resolve, 0))
    await pressKey('Escape')
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()

    ui.requestTourReplay()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(heading()).toHaveTextContent(headingOf(0))
  })
})

describe('OnboardingTour — steps that drive the app underneath', () => {
  const indexOf = (id: string) => ONBOARDING_STEPS.findIndex(s => s.id === id)

  it('opens the Narrow panel and applies the demo hero filter on arrival', async () => {
    // This step's whole point is showing the dossier recompose live, so the
    // setup hook has to actually reach App.vue.
    const { emitted } = await renderTour()
    const i = indexOf('matches-narrow')
    await fireEvent.click(screen.getByRole('button', { name: `Go to step ${i + 1} of ${STEP_COUNT}` }))

    expect(emitted('open-narrow')).toHaveLength(1)
    expect(emitted('apply-hero-filter')?.at(-1)).toEqual(['lucio'])
  })

  it('reverses that setup when the user walks away from the step', async () => {
    // Leaving the filter applied would poison every later step's spotlight.
    const { emitted } = await renderTour()
    const i = indexOf('matches-narrow')
    await fireEvent.click(screen.getByRole('button', { name: `Go to step ${i + 1} of ${STEP_COUNT}` }))
    await fireEvent.click(nextBtn())

    expect(emitted('clear-filters')).toHaveLength(1)
    expect(emitted('close-narrow')).toHaveLength(1)
  })

  it('opens and then closes the demo match around the detail-panel step', async () => {
    const { emitted } = await renderTour()
    const i = indexOf('matches-detail')
    await fireEvent.click(screen.getByRole('button', { name: `Go to step ${i + 1} of ${STEP_COUNT}` }))
    expect(emitted('open-match')?.at(-1)).toEqual(['demo:match:2026-05-10T22:21:11'])

    await fireEvent.click(nextBtn())
    expect(emitted('close-match')).toHaveLength(1)
  })

  it('Enter on the last step finishes instead of running off the end', async () => {
    localStorage.setItem(ONBOARDING_RESUME_KEY, String(LAST_INDEX))
    const { seedAndSwitchToTest } = await renderTour()
    expect(heading()).toHaveTextContent(headingOf(LAST_INDEX))

    await pressKey('Enter')
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
    expect(seedAndSwitchToTest).not.toHaveBeenCalled()
  })

  it('Enter on any other step just advances', async () => {
    await renderTour()
    await pressKey('Enter')
    expect(heading()).toHaveTextContent(headingOf(1))
  })

  it('leaves keys it does not own alone', async () => {
    await renderTour()
    await pressKey('j')
    await pressKey('Tab')
    expect(heading()).toHaveTextContent(headingOf(0))
  })
})
