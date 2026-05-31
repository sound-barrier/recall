import { ref, computed, onMounted } from 'vue'

import { usePersistedRef, parseBoolish, serializeBoolish } from './usePersistedRef'

// First-launch onboarding tour. Redesigned from a four-step static
// briefing into a **spotlighted product tour** that walks the user
// through every meaningful surface: each tab, the headline buttons
// inside it, the filter rail, the detail panel, the Unknown card.
// Every step lights up a single target element (SVG-mask cutout with
// viewfinder corner brackets), pairs it with an anchored callout, and
// optionally drives the underlying app — switching tabs, opening the
// detail panel, scrolling the source-files block — so the user sees
// real chrome lit up rather than a static description.
//
// Mock data: the tour publishes a flag (`active`) that App.vue reads
// to swap the live `records` ref for the curated `DEMO_MATCHES` set
// in useDemoMatches.ts. The swap is purely in-memory; nothing is
// persisted to the server or to SQLite. The flag flips back on
// finish/skip/Escape so the user's real matches re-appear the moment
// the tour closes.
//
// Gate semantics (unchanged from the prior implementation): the tour
// auto-opens on mount when `recall.onboardingCompleted` is missing or
// anything other than the literal "true". Skip / finish / Escape-
// dismiss all flip the flag, so a user who closes the tour via ANY
// affordance never sees it again unless they explicitly `restart()`.

export const ONBOARDING_COMPLETED_KEY = 'recall.onboardingCompleted'

export type OnboardingViewId = 'settings' | 'ingest' | 'matches' | 'unknown'
export type CalloutPlacement = 'auto' | 'top' | 'bottom' | 'left' | 'right'

// Action context passed to a step's setup / teardown hook. The
// concrete implementation is supplied by App.vue; the controller
// itself doesn't import App.vue (would be a circular dep). Steps
// that don't need actions omit the hooks entirely.
export interface TourActionContext {
  goToView:   (v: OnboardingViewId) => void
  openMatch:  (matchKey: string) => void
  closeMatch: () => void
  // Narrow popover control — opens / closes the left-side filter
  // panel that lives inside MatchesView. App.vue drives this via a
  // DOM click on the `.dossier-actions .dossier-btn.primary`
  // trigger (and the `.np-close` button on the popover header), so
  // the tour exercises the same path a real user click would.
  openNarrow:  () => void | Promise<void>
  closeNarrow: () => void | Promise<void>
  // Filter mutation — applies a single hero filter / clears every
  // narrow facet. Bypasses the popover UI so a tour step can show
  // "Lucio filter applied" without animating through the picker.
  applyHeroFilter: (hero: string) => void
  clearFilters:    () => void
}

export interface OnboardingStep {
  // Unique id — also used as the e2e test hook (data-step).
  id: string
  // Optional monospace eyebrow ABOVE the step number. Defaults to
  // "OBJECTIVE N of TOTAL" when omitted.
  tag?: string
  // The h2 the screen reader announces and the callout displays.
  heading: string
  // One-or-two-sentence body. Keep under ~50 words; the callout
  // panel is narrow.
  body: string
  // Optional view to switch the underlying app to BEFORE this step
  // renders. The Welcome / Done steps omit it (the user sees
  // whichever view they were on).
  view?: OnboardingViewId
  // CSS selector for the element to spotlight. `null` (or omitted)
  // means "no spotlight — render the callout as a centred briefing
  // panel". Used for the Welcome step and the Done step.
  target?: string | null
  // Where the callout panel anchors relative to the target. `auto`
  // picks the side with the most room (default).
  placement?: CalloutPlacement
  // Optional setup hook: opens the detail panel, scrolls a block
  // into view, etc. Runs after the view switch and before the
  // spotlight calculates the target rect.
  setup?: (ctx: TourActionContext) => void | Promise<void>
  // Optional teardown hook: closes whatever setup() opened. Runs
  // when the user navigates AWAY from this step.
  teardown?: (ctx: TourActionContext) => void | Promise<void>
}

// Step list. Order matters — drives the Next button. ~12 stops
// covering the headline UX of every tab. Lifted into module scope so
// the e2e + Vitest pin against the same source of truth.
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  // ── 1. Welcome briefing (no target — centred panel) ─────────
  {
    id: 'welcome',
    tag: 'BRIEFING',
    heading: 'Welcome to Recall',
    body: 'Recall watches your Overwatch screenshots and turns them into a searchable match history. This guided tour walks every surface — you can skip anytime.',
    target: null,
  },
  // ── 2. Masthead tablist — the navigation primitive ──────────
  {
    id: 'tablist',
    heading: 'Five tabs',
    body: 'Each tab is one phase of the loop: Settings to configure, Parse to ingest, Matches to explore, Unknown to triage. Click them, press the underlined numbers, or use h / l to cycle.',
    target: '[role="tablist"]',
    placement: 'bottom',
  },
  // ── 3. Settings tab — where the user starts ─────────────────
  {
    id: 'settings-tab',
    heading: 'Settings (01)',
    body: 'First-time setup lives here. Recall auto-detects the default Overwatch ScreenShots folder; if it cannot find it, point Recall at the folder yourself.',
    target: '#tab-settings',
    placement: 'bottom',
    view: 'settings',
  },
  // ── 4. Screenshots folder row ───────────────────────────────
  // Target the empty-hero Auto-Detect button itself (rather than the
  // whole section) so the user sees the exact affordance to click on
  // first launch. On replay (dir already set), the empty-hero block
  // does not render and the spotlight gracefully collapses — the
  // body copy still explains the row's controls.
  {
    id: 'settings-folder',
    heading: 'Your screenshots folder',
    body: 'Click Auto-Detect Folder and Recall walks the standard Overwatch install paths. Choose Manually opens a folder picker; the row also exposes Change… and Reset once a folder is set.',
    target: '#sec-directories .empty-hero-actions .btn.primary',
    placement: 'right',
    view: 'settings',
  },
  // ── 5. Engine (Tesseract) row ───────────────────────────────
  {
    id: 'settings-engine',
    heading: 'The OCR engine',
    body: 'Recall reads each screenshot with Tesseract. The status pill flips green once Recall finds a working install — Detect, Change Binary…, and Reset mirror the Folder controls.',
    target: '#sec-engine',
    placement: 'right',
    view: 'settings',
  },
  // ── 6. Parse tab ────────────────────────────────────────────
  {
    id: 'parse-tab',
    heading: 'Parse (02)',
    body: 'Once Settings is green, switch to Parse. The big primary button kicks off a one-shot ingest; the Watch toggle keeps Recall reading your folder while you play.',
    target: '#tab-ingest',
    placement: 'bottom',
    view: 'ingest',
  },
  // ── 7. The Parse button itself ──────────────────────────────
  {
    id: 'parse-button',
    heading: 'The Parse button',
    body: 'Click this big primary action to scan your screenshots folder and merge every new file into your match history. The progress panel below it streams per-file status as Tesseract reads each image.',
    target: '#panel-ingest .btn.primary.big',
    placement: 'right',
    view: 'ingest',
  },
  // ── 8. Matches tab — the dossier ───────────────────────────
  {
    id: 'matches-tab',
    heading: 'Matches (03)',
    body: 'Your history. The dossier on top summarises winrate, K/D/A, top heroes and maps. Every screenshot you parse rolls up into this view.',
    target: '#tab-matches',
    placement: 'bottom',
    view: 'matches',
  },
  // ── 9. Dossier — the rolled-up summary ─────────────────────
  {
    id: 'matches-dossier',
    heading: 'The dossier',
    body: 'Headline KPIs across the current narrow: winrate, K/D/A, total time, most-played hero. Plus the Most-played heroes / maps bar breakdowns.',
    target: '.set-dossier',
    placement: 'bottom',
    view: 'matches',
  },
  // ── 10. Narrow + live Lucio filter demo ────────────────────
  // setup() opens the Narrow popover (via App.vue's DOM click on
  // .dossier-actions .dossier-btn.primary) and applies a one-hero
  // filter so the user sees the dossier + list collapse to a
  // single hero in real time. teardown() reverses both — clears
  // the picked-heroes set and closes the popover — so the next
  // step lands on an unfiltered Matches view.
  {
    id: 'matches-narrow',
    heading: 'Narrow to one hero',
    body: 'Recall just opened the Narrow panel and filtered the set to Lucio. Pick any combination of hero, map, role, result, date, or free-text search; the dossier above and the list behind both update as you go.',
    target: '#narrow-popover',
    placement: 'right',
    view: 'matches',
    setup: async (ctx) => {
      await ctx.openNarrow()
      ctx.applyHeroFilter('lucio')
    },
    teardown: async (ctx) => {
      ctx.clearFilters()
      await ctx.closeNarrow()
    },
  },
  // ── 11. Match list ─────────────────────────────────────────
  {
    id: 'matches-list',
    heading: 'Click any match',
    body: 'Each row is one match. Click to open the detail panel on the right; once open, ←/→/h/l walk between matches and screenshots inside the same match.',
    target: '.leaves-list',
    placement: 'top',
    view: 'matches',
  },
  // ── 12. Detail panel — opened on a demo match ──────────────
  // setup() opens the Lucio / Rialto demo match so the user sees
  // the actual right-side panel rather than imagining it from the
  // body copy. teardown() closes it so the next step's spotlight
  // isn't covered by the panel.
  {
    id: 'matches-detail',
    heading: 'The detail panel',
    body: 'Clicking a row opens this panel. Every screenshot tied to the match lives here — scoreboards, summaries, personal cards — plus annotation, hide, and leaver controls. Use h / l to walk through matches without closing.',
    target: 'aside.detail-panel',
    placement: 'left',
    view: 'matches',
    setup: (ctx) => {
      ctx.openMatch('demo:match:2026-05-10T22:21:11')
    },
    teardown: (ctx) => {
      ctx.closeMatch()
    },
  },
  // ── 13. Unknown tab — triage ───────────────────────────────
  {
    id: 'unknown-tab',
    heading: 'Unknown (04)',
    body: 'Screenshots that did not fully parse land here. Add the missing screenshot type and Parse again, or click the source filename to see the original.',
    target: '#tab-unknown',
    placement: 'bottom',
    view: 'unknown',
  },
  // ── 14. Cheatsheet pointer (no target — centred briefing) ──
  {
    id: 'cheatsheet',
    heading: 'Keyboard shortcuts',
    body: 'Press ? anywhere to open the cheatsheet. h / l navigate left and right; j / k navigate up and down. The lightbox uses the same letters for screenshots.',
    target: null,
  },
  // ── 15. Done ───────────────────────────────────────────────
  {
    id: 'done',
    tag: 'BRIEFING COMPLETE',
    heading: 'You\'re ready to play',
    body: 'You can replay this tour anytime from Settings → Advanced → Replay onboarding. The dossier above is mock data — your real matches return the moment you close this tour.',
    target: null,
  },
]

export interface UseOnboardingTourOptions {
  autoOpenOnMount?: boolean
  // Concrete actions wired by the consumer (App.vue). Required when
  // any step uses `setup` / `teardown` / `view`. Tests construct the
  // composable with no-op action shims when they only exercise the
  // step-machine.
  actions?: TourActionContext
}

export function useOnboardingTour(opts: UseOnboardingTourOptions = {}) {
  const { value: completed, set: setCompleted } = usePersistedRef<boolean>({
    key: ONBOARDING_COMPLETED_KEY,
    defaultValue: false,
    parse: parseBoolish,
    serialize: serializeBoolish,
  })

  const open = ref(false)
  const stepIndex = ref(0)
  // `active` flips true while a step is animating-out a previous step
  // and animating-in the new one. Components that watch `active` (e.g.
  // App.vue's records swap) treat the entire window as a single "tour
  // is on" state — they don't need to track step boundaries.
  const active = computed(() => open.value)

  const totalSteps = ONBOARDING_STEPS.length
  const step       = computed(() => ONBOARDING_STEPS[stepIndex.value]!)
  const isFirstStep = computed(() => stepIndex.value === 0)
  const isLastStep  = computed(() => stepIndex.value === totalSteps - 1)
  const stepNumber = computed(() => stepIndex.value + 1)

  onMounted(() => {
    if (opts.autoOpenOnMount === false) return
    if (!completed.value) open.value = true
  })

  async function applyStepEffects(nextIndex: number, prevIndex: number) {
    const prevStep = ONBOARDING_STEPS[prevIndex]
    const nextStep = ONBOARDING_STEPS[nextIndex]
    if (!nextStep) return
    if (opts.actions && prevStep?.teardown) {
      await prevStep.teardown(opts.actions)
    }
    if (opts.actions && nextStep.view) {
      opts.actions.goToView(nextStep.view)
    }
    if (opts.actions && nextStep.setup) {
      await nextStep.setup(opts.actions)
    }
  }

  async function next() {
    if (isLastStep.value) {
      finish()
      return
    }
    const prev = stepIndex.value
    stepIndex.value += 1
    await applyStepEffects(stepIndex.value, prev)
  }

  async function prev() {
    if (isFirstStep.value) return
    const prevIdx = stepIndex.value
    stepIndex.value -= 1
    await applyStepEffects(stepIndex.value, prevIdx)
  }

  async function goToStep(index: number) {
    if (index < 0 || index >= totalSteps) return
    const prevIdx = stepIndex.value
    stepIndex.value = index
    await applyStepEffects(stepIndex.value, prevIdx)
  }

  function finish() {
    setCompleted(true)
    // Run teardown on the step the user was on at finish time so the
    // demo state cleans up before we close.
    const lastStep = ONBOARDING_STEPS[stepIndex.value]
    if (opts.actions && lastStep?.teardown) {
      void lastStep.teardown(opts.actions)
    }
    open.value = false
    stepIndex.value = 0
  }

  // Skip is functionally equivalent to finish.
  function skip() {
    finish()
  }

  // Re-open from step 0 (Settings → Advanced "Replay onboarding tour").
  async function restart() {
    stepIndex.value = 0
    open.value = true
    if (opts.actions) {
      const s = ONBOARDING_STEPS[0]
      if (s?.view) opts.actions.goToView(s.view)
      if (s?.setup) await s.setup(opts.actions)
    }
  }

  return {
    open,
    active,
    stepIndex,
    step,
    totalSteps,
    stepNumber,
    isFirstStep,
    isLastStep,
    completed: computed(() => completed.value),
    next,
    prev,
    goToStep,
    finish,
    skip,
    restart,
  }
}
