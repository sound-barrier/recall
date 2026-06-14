import { afterEach, describe, expect, it } from 'vitest'
import { ref, defineComponent, h, nextTick, type Ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'

import { useScrollLock, _resetScrollLockForTest } from '@/composables/useScrollLock'

const wrappers: VueWrapper[] = []

function host(active: Ref<boolean>) {
  const w = mount(defineComponent({
    setup() {
      useScrollLock(active)
      return () => h('div')
    },
  }))
  wrappers.push(w)
  return w
}

function wheel(target: EventTarget, deltaY = 100): WheelEvent {
  const e = new WheelEvent('wheel', { deltaY, cancelable: true, bubbles: true })
  target.dispatchEvent(e)
  return e
}

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
  _resetScrollLockForTest()
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
  document.body.style.paddingRight = ''
})

const htmlOverflow = () => document.documentElement.style.overflow
const bodyOverflow = () => document.body.style.overflow

describe('useScrollLock', () => {
  it('locks html + body overflow when active flips true and restores on false', async () => {
    const active = ref(false)
    host(active)
    expect(htmlOverflow()).toBe('')

    active.value = true
    await nextTick()
    expect(htmlOverflow()).toBe('hidden')
    expect(bodyOverflow()).toBe('hidden')

    active.value = false
    await nextTick()
    expect(htmlOverflow()).toBe('')
    expect(bodyOverflow()).toBe('')
  })

  it('locks immediately when active is already true at mount', () => {
    host(ref(true))
    expect(htmlOverflow()).toBe('hidden')
  })

  it('restores on unmount while still locked (no leak)', async () => {
    const w = host(ref(true))
    expect(htmlOverflow()).toBe('hidden')
    w.unmount()
    await nextTick()
    expect(htmlOverflow()).toBe('')
  })

  it('preserves a pre-existing inline overflow on restore', async () => {
    document.documentElement.style.overflow = 'scroll'
    const active = ref(true)
    host(active)
    expect(htmlOverflow()).toBe('hidden')
    active.value = false
    await nextTick()
    expect(htmlOverflow()).toBe('scroll')
  })

  it('stays locked until the LAST of several holders releases', async () => {
    const a = ref(true)
    const b = ref(true)
    host(a)
    host(b)
    expect(htmlOverflow()).toBe('hidden')

    a.value = false
    await nextTick()
    expect(htmlOverflow()).toBe('hidden')

    b.value = false
    await nextTick()
    expect(htmlOverflow()).toBe('')
  })

  it('cancels a background wheel while locked so nothing is queued to jump', () => {
    host(ref(true))
    const target = document.createElement('div')
    document.body.appendChild(target)
    expect(wheel(target).defaultPrevented).toBe(true)
    target.remove()
  })

  it('does not cancel the wheel when unlocked', () => {
    host(ref(false))
    const target = document.createElement('div')
    document.body.appendChild(target)
    expect(wheel(target).defaultPrevented).toBe(false)
    target.remove()
  })

  it('lets the wheel through when it lands inside a scrollable overlay area', () => {
    host(ref(true))
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 200, configurable: true })
    Object.defineProperty(scroller, 'scrollTop', { value: 0, writable: true, configurable: true })
    document.body.appendChild(scroller)
    const child = document.createElement('span')
    scroller.appendChild(child)
    // At the top, scrolling DOWN → the scroller has room → allow.
    expect(wheel(child, 100).defaultPrevented).toBe(false)
    scroller.remove()
  })
})
