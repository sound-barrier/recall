import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { ref, defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'

import {
  useContextualCallout,
  activeCalloutId,
} from './useContextualCallout'
import {
  CONTEXTUAL_CALLOUT_KEY_PREFIX,
  ONBOARDING_COMPLETED_KEY,
} from './storageKeys'

// happy-dom's default localStorage is a no-op stub. The composable's
// `try { localStorage.... } catch` falls into the catch and short-
// circuits to "seen=true," which would mask every test. Stub a real
// in-memory map.
function stubLocalStorage(): Record<string, string> {
  const store: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem:    (k: string) => store[k] ?? null,
    setItem:    (k: string, v: string) => { store[k] = String(v) },
    removeItem: (k: string) => { delete store[k] },
    clear:      () => { for (const k of Object.keys(store)) delete store[k] },
    key:        (i: number) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length },
  })
  return store
}

// Tiny harness that exposes the composable's controller + gate so
// each test drives the false→true edge and asserts on `active()`.
function makeHarness(id: string, initialGate = false) {
  const gate = ref(initialGate)
  let controller: ReturnType<typeof useContextualCallout> | null = null
  const Comp = defineComponent({
    setup() {
      controller = useContextualCallout({ id, gate: () => gate.value })
      return () => h('div')
    },
  })
  const wrapper = mount(Comp)
  return { gate, controller: controller!, wrapper }
}

beforeEach(() => {
  activeCalloutId.value = null
  stubLocalStorage()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useContextualCallout', () => {
  it('does not fire when the gate stays false', async () => {
    const { controller } = makeHarness('demo')
    await nextTick()
    expect(controller.active()).toBe(false)
    expect(activeCalloutId.value).toBeNull()
  })

  it('fires on the false → true edge', async () => {
    const { gate, controller } = makeHarness('demo')
    await nextTick()
    expect(controller.active()).toBe(false)
    gate.value = true
    await nextTick()
    expect(controller.active()).toBe(true)
    expect(activeCalloutId.value).toBe('demo')
  })

  it('fires on mount when the gate is already true', async () => {
    const { controller } = makeHarness('demo', true)
    await nextTick()
    expect(controller.active()).toBe(true)
  })

  it('dismiss() flips active off + persists seen=true', async () => {
    const { gate, controller } = makeHarness('demo')
    gate.value = true
    await nextTick()
    expect(controller.active()).toBe(true)
    controller.dismiss()
    await nextTick()
    expect(controller.active()).toBe(false)
    expect(activeCalloutId.value).toBeNull()
    expect(localStorage.getItem(`${CONTEXTUAL_CALLOUT_KEY_PREFIX}demo.seen`)).toBe('true')
  })

  it('does not fire when the callout was already seen', async () => {
    localStorage.setItem(`${CONTEXTUAL_CALLOUT_KEY_PREFIX}demo.seen`, 'true')
    const { gate, controller } = makeHarness('demo')
    gate.value = true
    await nextTick()
    expect(controller.active()).toBe(false)
  })

  it('respects the global onboarding-completed gate', async () => {
    // User dismissed/finished the full tour → don't re-tutorial via
    // contextual callouts.
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true')
    const { gate, controller } = makeHarness('demo')
    gate.value = true
    await nextTick()
    expect(controller.active()).toBe(false)
  })

  it('only one callout can be active at a time', async () => {
    const a = makeHarness('a', true)
    await nextTick()
    expect(a.controller.active()).toBe(true)
    expect(activeCalloutId.value).toBe('a')
    const b = makeHarness('b', true)
    await nextTick()
    expect(b.controller.active()).toBe(false)
    expect(activeCalloutId.value).toBe('a')
  })

  it('releases the singleton on unmount without marking seen', async () => {
    const { gate, controller, wrapper } = makeHarness('demo')
    gate.value = true
    await nextTick()
    expect(controller.active()).toBe(true)
    wrapper.unmount()
    await nextTick()
    expect(activeCalloutId.value).toBeNull()
    expect(localStorage.getItem(`${CONTEXTUAL_CALLOUT_KEY_PREFIX}demo.seen`)).toBeNull()
  })
})
