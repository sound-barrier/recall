import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useScrollAffordance } from '@/composables/matches/useScrollAffordance'

// Mount the composable inside a tiny component so the onMounted /
// onBeforeUnmount lifecycle hooks fire and the listener install +
// teardown can be observed.
function mountComposable(threshold = 400) {
  let result!: ReturnType<typeof useScrollAffordance>
  const Comp = defineComponent({
    setup() {
      result = useScrollAffordance(threshold)
      return () => h('div')
    },
  })
  const wrapper = mount(Comp)
  return { wrapper, result }
}

// Fake-rAF: invoke the callback synchronously so the threshold flip
// happens within the same microtask the test asserts on. The composable
// uses requestAnimationFrame to coalesce scroll events; we don't care
// about the coalescing semantics here, only the visible behaviour.
let rafCallbacks: FrameRequestCallback[] = []
beforeEach(() => {
  rafCallbacks = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    rafCallbacks.push(cb)
    return rafCallbacks.length
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  // happy-dom doesn't implement scrollY-with-side-effects; let tests
  // assign it directly.
  Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function flushRaf() {
  const cbs = rafCallbacks.slice()
  rafCallbacks = []
  for (const cb of cbs) cb(performance.now())
}

describe('useScrollAffordance', () => {
  it('starts false when window is at the top', () => {
    const { result, wrapper } = mountComposable()
    expect(result.isPastThreshold.value).toBe(false)
    wrapper.unmount()
  })

  it('flips to true after the user scrolls past the threshold', async () => {
    const { result, wrapper } = mountComposable(400)
    ;(window as unknown as { scrollY: number }).scrollY = 500
    window.dispatchEvent(new Event('scroll'))
    flushRaf()
    expect(result.isPastThreshold.value).toBe(true)
    wrapper.unmount()
  })

  it('flips back to false when scrolling back above the threshold', async () => {
    const { result, wrapper } = mountComposable(400)
    ;(window as unknown as { scrollY: number }).scrollY = 500
    window.dispatchEvent(new Event('scroll'))
    flushRaf()
    expect(result.isPastThreshold.value).toBe(true)
    ;(window as unknown as { scrollY: number }).scrollY = 100
    window.dispatchEvent(new Event('scroll'))
    flushRaf()
    expect(result.isPastThreshold.value).toBe(false)
    wrapper.unmount()
  })

  it('mounts in the past-threshold state when the user deep-linked into a scrolled position', () => {
    ;(window as unknown as { scrollY: number }).scrollY = 800
    const { result, wrapper } = mountComposable(400)
    expect(result.isPastThreshold.value).toBe(true)
    wrapper.unmount()
  })

  it('respects a custom threshold', async () => {
    const { result, wrapper } = mountComposable(100)
    ;(window as unknown as { scrollY: number }).scrollY = 150
    window.dispatchEvent(new Event('scroll'))
    flushRaf()
    expect(result.isPastThreshold.value).toBe(true)
    wrapper.unmount()
  })

  it('removes the scroll listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { wrapper } = mountComposable()
    wrapper.unmount()
    const removed = removeSpy.mock.calls.find(([name]) => name === 'scroll')
    expect(removed).toBeDefined()
  })

  it('scrollToTop calls window.scrollTo with smooth behavior by default', () => {
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.spyOn(window, 'matchMedia').mockImplementation((q) => ({
      matches: false,
      media: q, addEventListener: () => {}, removeEventListener: () => {},
      onchange: null, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }) as MediaQueryList)
    const { result, wrapper } = mountComposable()
    result.scrollToTop()
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    wrapper.unmount()
  })

  it('scrollToTop falls back to instant when prefers-reduced-motion is reduce', () => {
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.spyOn(window, 'matchMedia').mockImplementation((q) => ({
      matches: q.includes('reduce'),
      media: q, addEventListener: () => {}, removeEventListener: () => {},
      onchange: null, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }) as MediaQueryList)
    const { result, wrapper } = mountComposable()
    result.scrollToTop()
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
    wrapper.unmount()
  })
})
