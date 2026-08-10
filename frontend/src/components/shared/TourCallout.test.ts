import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/vue'

import TourCallout from '@/components/shared/TourCallout.vue'
import type { CalloutPlacement } from '@/composables/shared/useOnboardingTour'

// The callout is the tour's dialog: step copy, the skip-ahead pip row, and
// the Previous / Next / Done / Skip controls. Its POSITIONING is pure DOM
// geometry against a layout engine happy-dom does not have — that half is
// covered by tour-callout-helpers.test.ts (the placement solver + the
// connector edge-pick) and by the Playwright spotlight specs. What is
// pinned here is everything the callout decides from props: which pip is
// current, whether Previous is reachable, and whether the primary button
// means "next" or "done".

interface CalloutProps {
  target?: string | null
  placement?: CalloutPlacement
  eyebrow?: string
  num?: string
  heading?: string
  body?: string
  counter?: string
  stepCount?: number
  stepIndex?: number
  canBack?: boolean
  isLast?: boolean
}

function renderCallout(over: CalloutProps = {}) {
  return render(TourCallout, {
    props: {
      target:    null,
      placement: 'auto' as CalloutPlacement,
      eyebrow:   'OBJECTIVE 3',
      num:       '03',
      heading:   'Settings (01)',
      body:      'First-time setup lives here.',
      counter:   '03 / 18',
      stepCount: 5,
      stepIndex: 2,
      canBack:   true,
      isLast:    false,
      ...over,
    },
  })
}

const nextBtn = () => screen.getByRole('button', { name: /^Next/ })
const prevBtn = () => screen.getByRole('button', { name: 'Previous' })
const pips = () => screen.getAllByRole('button', { name: /^Go to step / })

beforeEach(() => {
  // The callout parks itself against window.innerWidth/Height; happy-dom
  // supplies both, so nothing to stub — but pin the viewport so a future
  // default change can't silently move the assertions above.
  window.innerWidth = 1280
  window.innerHeight = 800
})

afterEach(() => {
  // eslint-disable-next-line testing-library/no-node-access -- fixture teardown, not a query
  document.getElementById('tour-anchor')?.remove()
})

describe('TourCallout — step copy', () => {
  it('names the dialog by its heading and renders the eyebrow, number and counter', () => {
    renderCallout()
    // aria-labelledby points at the h2, so the dialog's accessible name IS
    // the step heading — that is what a screen reader announces on arrival.
    expect(screen.getByRole('dialog', { name: 'Settings (01)' })).toBeInTheDocument()
    expect(screen.getByText('OBJECTIVE 3')).toBeInTheDocument()
    expect(screen.getByText('03 / 18')).toBeInTheDocument()
    expect(screen.getByText('First-time setup lives here.')).toBeInTheDocument()
  })
})

describe('TourCallout — skip-ahead pips', () => {
  it('renders one pip per step and marks only the active one aria-current="step"', () => {
    renderCallout({ stepCount: 5, stepIndex: 2 })
    const all = pips()
    expect(all).toHaveLength(5)
    expect(all[2]).toHaveAttribute('aria-current', 'step')
    // Every other pip must NOT claim to be current — an over-eager
    // predicate here would announce five "current step"s at once.
    expect(all.filter(p => p.getAttribute('aria-current') === 'step')).toHaveLength(1)
    expect(all[0]).toHaveAccessibleName('Go to step 1 of 5')
    expect(all[4]).toHaveAccessibleName('Go to step 5 of 5')
  })

  it('emits jump with the ZERO-based index of the clicked pip', async () => {
    const { emitted } = renderCallout({ stepCount: 5, stepIndex: 2 })
    await fireEvent.click(pips()[4]!)
    // Pip 5 is index 4 — an off-by-one here would skip-ahead to the
    // wrong stop, which is silent (the tour still "works").
    expect(emitted('jump')).toEqual([[4]])
  })

  it('moves the current marker when the active index changes', async () => {
    const { rerender } = renderCallout({ stepCount: 3, stepIndex: 0 })
    expect(pips()[0]).toHaveAttribute('aria-current', 'step')
    await rerender({ stepIndex: 2 })
    expect(pips()[0]).not.toHaveAttribute('aria-current')
    expect(pips()[2]).toHaveAttribute('aria-current', 'step')
  })
})

describe('TourCallout — navigation controls', () => {
  it('disables Previous on the first step and clicking it emits nothing', async () => {
    const { emitted } = renderCallout({ canBack: false, stepIndex: 0 })
    expect(prevBtn()).toBeDisabled()
    await fireEvent.click(prevBtn())
    expect(emitted('back')).toBeUndefined()
  })

  it('emits back from an enabled Previous', async () => {
    const { emitted } = renderCallout({ canBack: true })
    await fireEvent.click(prevBtn())
    expect(emitted('back')).toHaveLength(1)
  })

  it('the primary button reads "Next" and emits next on a middle step', async () => {
    const { emitted } = renderCallout({ isLast: false })
    expect(nextBtn()).toHaveTextContent('Next')
    await fireEvent.click(nextBtn())
    expect(emitted('next')).toHaveLength(1)
    expect(emitted('finish')).toBeUndefined()
  })

  it('the SAME button reads "Done" and emits finish on the last step', async () => {
    // One button, two meanings — the branch that decides which is the
    // difference between closing the tour and running off its end.
    const { emitted } = renderCallout({ isLast: true, canBack: true })
    expect(screen.getByRole('button', { name: /^Done/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Next/ })).not.toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: /^Done/ }))
    expect(emitted('finish')).toHaveLength(1)
    expect(emitted('next')).toBeUndefined()
  })

  it('Skip tour stays available on every step, including the last', async () => {
    const { emitted } = renderCallout({ isLast: true })
    await fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }))
    expect(emitted('skip')).toHaveLength(1)
  })
})

describe('TourCallout — connector line', () => {
  it('draws no connector for a centered, target-less briefing step', () => {
    const { container } = renderCallout({ target: null })
    // The connector is decorative (aria-hidden) so it has no accessible
    // handle — its presence is the only observable of the "centered
    // briefing" branch.
    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container -- aria-hidden decoration, no accessible surface
    expect(container.querySelector('line')).toBeNull()
  })

  it('draws a connector once a target element exists to point at', async () => {
    const anchor = document.createElement('div')
    anchor.id = 'tour-anchor'
    document.body.appendChild(anchor)
    const { container } = renderCallout({ target: '#tour-anchor', placement: 'bottom' })
    await new Promise(resolve => setTimeout(resolve, 0))
    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container -- aria-hidden decoration, no accessible surface
    expect(container.querySelector('line')).not.toBeNull()
  })

  it('draws no connector when the step selector matches nothing', () => {
    const { container } = renderCallout({ target: '#never-rendered' })
    // A step pointing at chrome that is not on screen (a replayed tour
    // whose empty-state hero is gone) must degrade to the centered
    // briefing, not to a line ending at the viewport origin.
    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container -- aria-hidden decoration, no accessible surface
    expect(container.querySelector('line')).toBeNull()
  })
})
