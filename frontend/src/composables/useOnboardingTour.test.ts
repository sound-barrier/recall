import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  useOnboardingTour,
  ONBOARDING_COMPLETED_KEY,
  ONBOARDING_STEPS,
  type TourActionContext,
  type UseOnboardingTourOptions,
} from '@/composables/useOnboardingTour'
import { ONBOARDING_RESUME_KEY } from '@/composables/storageKeys'

// happy-dom doesn't ship a localStorage stub, so the existing
// persisted-pref tests in this directory all stub it via
// `vi.stubGlobal('localStorage', ...)`. Same pattern here so the
// test surface is identical to useShowHidden / useDensityMode / etc.

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

afterEach(() => { vi.unstubAllGlobals() })

// Mount a tiny harness so onMounted fires (usePersistedRef hydrates
// + this composable's auto-open both run there). Returns the live
// tour reference for assertions.
function mountWithTour(opts?: UseOnboardingTourOptions) {
  let tour!: ReturnType<typeof useOnboardingTour>
  mount(defineComponent({
    setup() {
      tour = useOnboardingTour(opts)
      return () => h('div')
    },
  }))
  return tour
}

describe('useOnboardingTour — first-launch gate', () => {
  it('auto-opens on mount when no completion flag is set', async () => {
    const tour = mountWithTour()
    await nextTick()
    expect(tour.open.value).toBe(true)
    expect(tour.stepIndex.value).toBe(0)
  })

  it('does not auto-open when the completion flag is already true', async () => {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true')
    const tour = mountWithTour()
    await nextTick()
    expect(tour.open.value).toBe(false)
  })

  it('treats anything other than the literal "true" as not completed', async () => {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'yes')
    const tour = mountWithTour()
    await nextTick()
    expect(tour.open.value).toBe(true)
  })

  it('honours autoOpenOnMount: false on first run', async () => {
    const tour = mountWithTour({ autoOpenOnMount: false })
    await nextTick()
    expect(tour.open.value).toBe(false)
  })
})

describe('useOnboardingTour — step navigation', () => {
  it('starts on the welcome step (0) with isFirstStep=true', async () => {
    const tour = mountWithTour()
    await nextTick()
    expect(tour.stepIndex.value).toBe(0)
    expect(tour.isFirstStep.value).toBe(true)
    expect(tour.isLastStep.value).toBe(false)
    expect(tour.stepNumber.value).toBe(1)
    expect(tour.step.value.heading).toMatch(/welcome to recall/i)
  })

  it('next() advances through every step in order', async () => {
    const tour = mountWithTour()
    await nextTick()
    const seen: string[] = [tour.step.value.heading]
    for (let i = 1; i < ONBOARDING_STEPS.length; i++) {
      tour.next()
      seen.push(tour.step.value.heading)
    }
    expect(seen).toEqual(ONBOARDING_STEPS.map(s => s.heading))
    expect(tour.isLastStep.value).toBe(true)
  })

  it('prev() steps back; bottoms out at step 0', async () => {
    const tour = mountWithTour()
    await nextTick()
    tour.next()
    tour.next()
    expect(tour.stepIndex.value).toBe(2)
    tour.prev()
    expect(tour.stepIndex.value).toBe(1)
    tour.prev()
    expect(tour.stepIndex.value).toBe(0)
    tour.prev() // no-op
    expect(tour.stepIndex.value).toBe(0)
  })

  it('next() on the last step finishes the tour', async () => {
    const tour = mountWithTour()
    await nextTick()
    for (let i = 0; i < ONBOARDING_STEPS.length - 1; i++) tour.next()
    expect(tour.isLastStep.value).toBe(true)
    tour.next()
    expect(tour.open.value).toBe(false)
    expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBe('true')
  })
})

describe('useOnboardingTour — finish / skip / restart', () => {
  it('skip() persists completion and closes', async () => {
    const tour = mountWithTour()
    await nextTick()
    tour.skip()
    expect(tour.open.value).toBe(false)
    expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBe('true')
  })

  it('finish() persists completion and closes', async () => {
    const tour = mountWithTour()
    await nextTick()
    tour.finish()
    expect(tour.open.value).toBe(false)
    expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBe('true')
  })

  it('finish() resets stepIndex to 0 so a future restart starts at the top', async () => {
    const tour = mountWithTour()
    await nextTick()
    tour.next()
    tour.next()
    expect(tour.stepIndex.value).toBe(2)
    tour.finish()
    expect(tour.stepIndex.value).toBe(0)
  })

  it('restart() re-opens after completion', async () => {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true')
    const tour = mountWithTour()
    await nextTick()
    expect(tour.open.value).toBe(false)
    tour.restart()
    expect(tour.open.value).toBe(true)
    expect(tour.stepIndex.value).toBe(0)
  })
})

describe('useOnboardingTour — step content shape', () => {
  it('has at least 3 steps (Welcome + Configure + Parse + Explore minimum)', () => {
    expect(ONBOARDING_STEPS.length).toBeGreaterThanOrEqual(3)
  })

  it('every step carries an id + heading + body', () => {
    for (const s of ONBOARDING_STEPS) {
      expect(s.id).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(s.heading).toBeTruthy()
      expect(s.body).toBeTruthy()
    }
  })

  it('every step\'s view (when set) points at a real tab', () => {
    const validViews = new Set(['settings', 'ingest', 'matches', 'unknown'])
    for (const s of ONBOARDING_STEPS) {
      if (s.view !== undefined) {
        expect(validViews.has(s.view)).toBe(true)
      }
    }
  })

  it('welcome step (0) has no view so the user keeps the view they landed on', () => {
    expect(ONBOARDING_STEPS[0]!.view).toBeUndefined()
    expect(ONBOARDING_STEPS[0]!.target ?? null).toBeNull()
  })

  it('the final step is a no-target Done briefing', () => {
    const last = ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1]!
    expect(last.id).toMatch(/done|complete|finish/)
    expect(last.target ?? null).toBeNull()
  })

  it('all step ids are unique (drives DOM keys + e2e selectors)', () => {
    const ids = new Set(ONBOARDING_STEPS.map(s => s.id))
    expect(ids.size).toBe(ONBOARDING_STEPS.length)
  })
})

describe('useOnboardingTour — explore-sample seed + switch', () => {
  function actionsStub(seed: TourActionContext['seedAndSwitchToTest']): TourActionContext {
    return {
      goToView: vi.fn(), openMatch: vi.fn(), closeMatch: vi.fn(),
      openNarrow: vi.fn(), closeNarrow: vi.fn(), applyHeroFilter: vi.fn(),
      clearFilters: vi.fn(), seedAndSwitchToTest: seed,
    }
  }
  const exploreIdx = ONBOARDING_STEPS.findIndex(s => s.id === 'explore-sample')

  it('exposes the new profiles + explore-sample steps', () => {
    const ids = ONBOARDING_STEPS.map(s => s.id)
    expect(ids).toContain('profiles')
    expect(ids).toContain('explore-sample')
    expect(ONBOARDING_STEPS.find(s => s.id === 'profiles')!.target).toBe('.profile-switcher')
    // explore-sample sits second-to-last; Done is last.
    expect(exploreIdx).toBe(ONBOARDING_STEPS.length - 2)
  })

  it('next() on explore-sample seeds + switches (parking the next step) instead of advancing', async () => {
    const seed = vi.fn().mockResolvedValue(undefined)
    const tour = mountWithTour({ actions: actionsStub(seed) })
    await nextTick()
    await tour.goToStep(exploreIdx)
    expect(tour.step.value.id).toBe('explore-sample')
    await tour.next()
    expect(seed).toHaveBeenCalledWith(exploreIdx + 1)
    // On success the real action reloads the SPA — here it's stubbed, so
    // the controller stays put rather than double-advancing.
    expect(tour.stepIndex.value).toBe(exploreIdx)
  })

  it('falls through to a plain advance when seed + switch rejects', async () => {
    const seed = vi.fn().mockRejectedValue(new Error('seed failed'))
    const tour = mountWithTour({ actions: actionsStub(seed) })
    await nextTick()
    await tour.goToStep(exploreIdx)
    await tour.next()
    expect(seed).toHaveBeenCalled()
    expect(tour.stepIndex.value).toBe(exploreIdx + 1) // reached Done on demo
  })

  it('reopens at the parked resume step on mount and clears the key', async () => {
    const doneIdx = ONBOARDING_STEPS.length - 1
    localStorage.setItem(ONBOARDING_RESUME_KEY, String(doneIdx))
    const tour = mountWithTour()
    await nextTick()
    expect(tour.open.value).toBe(true)
    expect(tour.stepIndex.value).toBe(doneIdx)
    expect(localStorage.getItem(ONBOARDING_RESUME_KEY)).toBeNull()
  })

  it('ignores an out-of-range resume value', async () => {
    localStorage.setItem(ONBOARDING_RESUME_KEY, '999')
    const tour = mountWithTour()
    await nextTick()
    // Falls back to the normal first-run auto-open at step 0.
    expect(tour.stepIndex.value).toBe(0)
  })
})
