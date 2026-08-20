import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'

import type { FocusEntry } from '@/api'
import type { SessionSummary } from '@/match/dossier/match-momentum-helpers'
import { topFocus } from '@/match/reviews/focus-items'
import { useFocusQuery } from '@/queries/focus'

// What to focus on, said once while you are actually playing.
//
// Recall knows a session is live because a parse just landed inside one —
// which is also why nothing here fetches at boot: the read is gated on that
// session existing, so it only ever runs off a user-initiated parse.
//
// Dismissal keys on the SESSION, the way the tally toast and the tilt nudge
// both do. Keyed on anything shorter, "×" would survive exactly one game and
// the same three lines would come back all evening.

export interface FocusNudge {
  /** The three to say, in the order the server put them. */
  items: Ref<FocusEntry[]>
  visible: Ref<boolean>
  dismiss: () => void
}

// The longest single hop before re-reading the wall clock. setTimeout counts
// elapsed AWAKE time, so one long delay does not survive a laptop lid —
// which is exactly how "This session" was still on screen the next morning,
// about last night's games. Same rule, same reason, as SessionSummaryToast.
const MAX_HOP_MS = 60_000

export function useFocusNudge(session: Ref<SessionSummary | null>): FocusNudge {
  const live = computed(() => session.value !== null)
  const query = useFocusQuery(live)
  const dismissedFor = ref<number | null>(null)
  const expired = ref(false)

  let timer: number | null = null
  function clearTimer(): void {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
  }

  // Armed from the session's own expiry rather than a fixed delay: the
  // session ends when the gap since its newest match elapses, and the nudge
  // has nothing left to say about a session that is over.
  function armExpiry(endsAt: number): void {
    clearTimer()
    const remaining = endsAt - Date.now()
    if (remaining <= 0) {
      expired.value = true
      return
    }
    timer = window.setTimeout(() => armExpiry(endsAt), Math.min(remaining, MAX_HOP_MS))
  }

  watch(session, (next) => {
    expired.value = false
    clearTimer()
    if (next) armExpiry(next.endsAt)
  }, { immediate: true })

  onBeforeUnmount(clearTimer)

  const items = computed(() => topFocus(query.data.value ?? []))
  const visible = computed(() =>
    session.value !== null
    && !expired.value
    && session.value.startedAt !== dismissedFor.value
    && items.value.length > 0)

  function dismiss(): void {
    // Only a nudge that was actually on screen counts as read. A caller that
    // dismisses everything (an Escape binding, say) must not silence a
    // session whose list simply had not arrived yet.
    if (!visible.value) return
    dismissedFor.value = session.value?.startedAt ?? null
  }

  return { items, visible, dismiss }
}
