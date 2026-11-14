import { SWAP_HOLD_MS } from '@/composables/shared/useSwapHold'

// Macrotask flush — resolves after pending microtasks plus one timer
// turn, mirroring @vue/test-utils' flushPromises (which the Testing
// Library stack doesn't ship). Await it after driving async component
// behavior so promise chains and Vue's scheduler settle before
// asserting on the DOM.
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/**
 * Let a swap hold (useSwapHold) run out on real timers — what a person's
 * deliberate second click waits for without noticing. Fake-timer suites
 * advance SWAP_HOLD_MS instead.
 */
export function waitOutSwapHold(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, SWAP_HOLD_MS + 10) })
}
