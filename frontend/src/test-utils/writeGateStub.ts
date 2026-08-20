import { computed, ref } from 'vue'

// A drop-in for `@/composables/shared/useWriteGate` in unit tests.
//
// The real gate reads the coaching-session store, so
// a leaf component that merely DISABLES on it would otherwise need Pinia +
// a query client stood up. Tests that only need "writes are open" mock the
// module with this stub; tests that pin the locked branch flip it with
// setWritesLocked().
//
//   vi.mock('@/composables/shared/useWriteGate', async () =>
//     import('@/test-utils/writeGateStub'))
//
// The gate's OWN contract (which lock wins, what the reason says) is
// covered by useWriteGate.test.ts against the real thing.

const locked = ref(false)
const inSession = ref(false)

export const STUB_LOCK_REASON = 'Writes are locked.'

/** Lock or unlock writes for the rest of the test. `session` also flips the session-only flag. */
export function setWritesLocked(value: boolean, opts: { session?: boolean } = {}): void {
  locked.value = value
  inSession.value = value && (opts.session ?? false)
}

/** Back to the permissive default — call it in a beforeEach. */
export function resetWriteGate(): void {
  locked.value = false
  inSession.value = false
}

export function useWriteGate() {
  const writesLocked = computed(() => locked.value)
  const lockReason = computed(() => (locked.value ? STUB_LOCK_REASON : ''))
  return {
    writesLocked,
    sessionActive: computed(() => inSession.value),
    lockReason,
    lockedTitle: (title: string) => (locked.value ? STUB_LOCK_REASON : title),
    guardWrite: () => !locked.value,
  }
}
