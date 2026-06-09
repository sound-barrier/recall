import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'

import { useVirtualWindow } from './useVirtualWindow'

// happy-dom doesn't expose a real layout engine, so .clientHeight
// and .scrollTop have to be poked directly on the element after
// mount. We override the element's getters so the composable's
// syncGeometry() reads the values we want for each test case.
function withGeometry(el: HTMLElement, scrollTop: number, clientHeight: number) {
  Object.defineProperty(el, 'scrollTop',    { value: scrollTop,    writable: true, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, writable: true, configurable: true })
}

// Tiny harness — mounts a component that wires useVirtualWindow to a
// controllable container ref. Exposes the controller refs + the
// container element so each test can mutate geometry, fire a scroll,
// and assert the resulting window.
function makeHarness(items: number[], itemHeight = 50, overscan?: number) {
  const itemsRef = ref<readonly number[]>(items)
  let api: ReturnType<typeof useVirtualWindow<number>> | null = null
  let container: HTMLElement | null = null
  const Comp = defineComponent({
    setup() {
      const containerRef = ref<HTMLElement | null>(null)
      api = useVirtualWindow<number>({
        items: itemsRef,
        itemHeight,
        containerRef,
        overscan,
      })
      return () => h('div', { ref: containerRef, class: 'vw-container' })
    },
  })
  const wrapper = mount(Comp, { attachTo: document.body })
  container = wrapper.element as HTMLElement
  // happy-dom defaults to 0 for both — give the harness a default
  // viewport so the first computed window isn't overscan-only.
  withGeometry(container, 0, 600)
  return { wrapper, api: api!, itemsRef, container: container! }
}

// requestAnimationFrame in happy-dom delays one tick. To keep tests
// synchronous, mock it as immediate so syncGeometry runs in the
// same tick as the scroll event.
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 0 as unknown as number
  })
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
  // happy-dom doesn't ship ResizeObserver — the composable falls
  // back to window.resize, which is fine for these tests.
  vi.stubGlobal('ResizeObserver', undefined)
})
afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('useVirtualWindow', () => {
  it('renders the initial window at scrollTop=0 with default overscan', async () => {
    // 100 items × 50px each in a 600px viewport.
    // visibleEnd = ceil((0 + 600) / 50) = 12 rows visible.
    // Plus 5 overscan rows = 17 rendered initially.
    const { api } = makeHarness([...Array(100).keys()])
    await nextTick()
    expect(api.startIndex.value).toBe(0)
    expect(api.endIndex.value).toBe(17)
    expect(api.visibleItems.value).toHaveLength(17)
    expect(api.visibleItems.value[0]).toBe(0)
    expect(api.topSpacer.value).toBe(0)
    expect(api.bottomSpacer.value).toBe((100 - 17) * 50)
  })

  it('clamps endIndex at items.length when the list is short', async () => {
    const { api } = makeHarness([1, 2, 3])
    await nextTick()
    expect(api.endIndex.value).toBe(3)
    expect(api.visibleItems.value).toEqual([1, 2, 3])
    expect(api.bottomSpacer.value).toBe(0)
  })

  it('slides the window as the container scrolls', async () => {
    const { api, container } = makeHarness([...Array(1000).keys()])
    await nextTick()
    // Scroll to row 500: scrollTop = 500 * 50 = 25000.
    withGeometry(container, 25000, 600)
    container.dispatchEvent(new Event('scroll'))
    await nextTick()
    // visibleStart = floor(25000 / 50) = 500.
    // visibleEnd   = ceil((25000 + 600) / 50) = 512.
    // With overscan 5: [495, 517).
    expect(api.startIndex.value).toBe(495)
    expect(api.endIndex.value).toBe(517)
    expect(api.visibleItems.value).toHaveLength(22)
    expect(api.visibleItems.value[0]).toBe(495)
    expect(api.topSpacer.value).toBe(495 * 50)
    expect(api.bottomSpacer.value).toBe((1000 - 517) * 50)
  })

  it('honours a custom overscan', async () => {
    const { api } = makeHarness([...Array(100).keys()], 50, 0)
    await nextTick()
    // No overscan → exactly the 12 visible rows.
    expect(api.endIndex.value - api.startIndex.value).toBe(12)
  })

  it('caps overscan-induced startIndex at 0', async () => {
    // Scrolled to row 2 (out of 100), overscan 5 would pull
    // startIndex to -3 — must clamp to 0.
    const { api, container } = makeHarness([...Array(100).keys()])
    await nextTick()
    withGeometry(container, 2 * 50, 600)
    container.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(api.startIndex.value).toBe(0)
    expect(api.topSpacer.value).toBe(0)
  })

  it('resets scroll to 0 when the items reference changes', async () => {
    const { api, itemsRef, container } = makeHarness([...Array(200).keys()])
    await nextTick()
    // Scroll halfway.
    withGeometry(container, 100 * 50, 600)
    container.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(api.startIndex.value).toBeGreaterThan(50)
    // Replace the items list (e.g. user narrowed the set).
    itemsRef.value = [...Array(10).keys()]
    await nextTick()
    expect(container.scrollTop).toBe(0)
    expect(api.startIndex.value).toBe(0)
    expect(api.visibleItems.value).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('falls back to overscan-only rendering when clientHeight is 0', async () => {
    // Edge case: container not yet measured (initial mount in a
    // hidden tab). The composable should still render SOMETHING so
    // the first paint after the container reveals isn't blank.
    const itemsRef = ref<readonly number[]>([...Array(100).keys()])
    const Comp = defineComponent({
      setup() {
        const containerRef = ref<HTMLElement | null>(null)
        const api = useVirtualWindow<number>({
          items:      itemsRef,
          itemHeight: 50,
          containerRef,
          overscan:   5,
        })
        return () => h('div', { ref: containerRef, class: 'vw-container' }, [
          h('span', { 'data-start': api.startIndex.value }),
          h('span', { 'data-end':   api.endIndex.value }),
        ])
      },
    })
    const wrapper = mount(Comp, { attachTo: document.body })
    const el = wrapper.element as HTMLElement
    // Force clientHeight = 0 BEFORE the mounted hook reads geometry.
    withGeometry(el, 0, 0)
    await nextTick()
    // Overscan-only batch (2 * overscan = 10 items).
    expect(wrapper.find('[data-start]').attributes('data-start')).toBe('0')
    expect(wrapper.find('[data-end]').attributes('data-end')).toBe('10')
    wrapper.unmount()
  })

  it('emits topSpacer + bottomSpacer that preserve the scroll height', async () => {
    // The whole virtualizer's correctness story: top + visible +
    // bottom must equal items.length * itemHeight. The scrollbar
    // wouldn't move correctly otherwise.
    const { api, container } = makeHarness([...Array(1000).keys()])
    await nextTick()
    withGeometry(container, 5000, 600)
    container.dispatchEvent(new Event('scroll'))
    await nextTick()
    const visibleHeight = api.visibleItems.value.length * 50
    const total = api.topSpacer.value + visibleHeight + api.bottomSpacer.value
    expect(total).toBe(1000 * 50)
  })

  describe('mode: window', () => {
    // In window mode the composable subtracts the list's
    // getBoundingClientRect().top from window.scrollY to get the
    // list-relative scroll. We stub getBoundingClientRect + window
    // dimensions to drive each scenario.

    function withRect(el: HTMLElement, rect: Partial<DOMRect>) {
      const base = {
        top: 0, bottom: 0, left: 0, right: 0,
        width: 0, height: 0, x: 0, y: 0,
        toJSON: () => ({}),
      } as DOMRect
      Object.defineProperty(el, 'getBoundingClientRect', {
        value: () => ({ ...base, ...rect }),
        writable: true, configurable: true,
      })
    }

    function makeWindowHarness(items: number[], itemHeight = 50) {
      const itemsRef = ref<readonly number[]>(items)
      let api: ReturnType<typeof useVirtualWindow<number>> | null = null
      const Comp = defineComponent({
        setup() {
          const containerRef = ref<HTMLElement | null>(null)
          api = useVirtualWindow<number>({
            items: itemsRef,
            itemHeight,
            containerRef,
            mode: 'window',
          })
          return () => h('div', { ref: containerRef, class: 'vw-container' })
        },
      })
      const wrapper = mount(Comp, { attachTo: document.body })
      const container = wrapper.element as HTMLElement
      return { wrapper, api: api!, container, itemsRef }
    }

    it('renders the top of the list when the list sits at the viewport top', async () => {
      // List header at y=0, list runs full viewport. With a 600px
      // viewport and 50px rows, 12 fit + 5 overscan = [0, 17).
      Object.defineProperty(window, 'innerHeight', { value: 600, writable: true, configurable: true })
      const { api, container } = makeWindowHarness([...Array(100).keys()])
      withRect(container, { top: 0, bottom: 5000, height: 100 * 50 })
      window.dispatchEvent(new Event('scroll'))
      await nextTick()
      expect(api.startIndex.value).toBe(0)
      expect(api.endIndex.value).toBe(17)
      expect(api.topSpacer.value).toBe(0)
    })

    it('slides the window as the page scrolls past the list', async () => {
      // List 5000px tall, starts at y=0 — page scrolls 1000px so
      // the list's top is now at y=-1000. List-relative scrollTop
      // = 1000.
      Object.defineProperty(window, 'innerHeight', { value: 600, writable: true, configurable: true })
      const { api, container } = makeWindowHarness([...Array(100).keys()])
      withRect(container, { top: -1000, bottom: 4000, height: 5000 })
      window.dispatchEvent(new Event('scroll'))
      await nextTick()
      // visibleStart = floor(1000 / 50) = 20
      // visibleEnd   = ceil((1000 + 600) / 50) = 32
      // With overscan 5: [15, 37).
      expect(api.startIndex.value).toBe(15)
      expect(api.endIndex.value).toBe(37)
    })

    it('clips clientHeight when the list is taller than the viewport but partially visible', async () => {
      // List runs from y=200 to y=10200 (5000 rows × 50px). Viewport
      // is 600px tall — so only 600-200=400px of the list is in
      // view. List-relative scrollTop = 0 (top hasn't scrolled).
      Object.defineProperty(window, 'innerHeight', { value: 600, writable: true, configurable: true })
      const { api, container } = makeWindowHarness([...Array(5000).keys()])
      withRect(container, { top: 200, bottom: 10200, height: 10000 })
      window.dispatchEvent(new Event('scroll'))
      await nextTick()
      // 400px / 50px = 8 visible rows + overscan = 13 rendered.
      expect(api.startIndex.value).toBe(0)
      expect(api.endIndex.value).toBe(13)
    })
  })
})
