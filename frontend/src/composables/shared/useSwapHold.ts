import { getCurrentScope, onScopeDispose, readonly, ref } from 'vue'

/**
 * How long a control that has just swapped in place stays held. Long enough
 * to swallow the second press of a double-click (or of Enter pressed twice),
 * short enough that a deliberate second decision never notices it.
 */
export const SWAP_HOLD_MS = 600

/**
 * The hold a control earns when it swaps in place for its opposite: Run for
 * Stop, an arm button for its Confirm, Dismiss for "Confirm dismiss?".
 *
 * The second press of a double-click lands on the same spot a beat later —
 * on the control that just took the first one's place — so that control
 * refuses for SWAP_HOLD_MS after the swap. Render it `aria-disabled` while
 * `held` (not `disabled`: a disabled button drops the focus a keyboard user
 * was just handed) and refuse in the handler. The timer dies with the scope.
 */
export function useSwapHold(ms = SWAP_HOLD_MS) {
  const held = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  function release(): void {
    if (timer !== null) clearTimeout(timer)
    timer = null
    held.value = false
  }

  /** Start (or restart) the hold — call it at the moment of the swap. */
  function hold(): void {
    if (timer !== null) clearTimeout(timer)
    held.value = true
    timer = setTimeout(release, ms)
  }

  // A store or component scope owns the timer; a bare call (a unit test
  // driving the composable directly) has no scope to die with.
  if (getCurrentScope()) onScopeDispose(release)

  return { held: readonly(held), hold, release }
}
