import { computed, ref, type Ref } from 'vue'

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

export function useFocusNudge(session: Ref<SessionSummary | null>): FocusNudge {
  const live = computed(() => session.value !== null)
  const query = useFocusQuery(live)
  const dismissedFor = ref<number | null>(null)

  const items = computed(() => topFocus(query.data.value ?? []))
  const visible = computed(() =>
    session.value !== null
    && session.value.startedAt !== dismissedFor.value
    && items.value.length > 0)

  function dismiss(): void {
    dismissedFor.value = session.value?.startedAt ?? null
  }

  return { items, visible, dismiss }
}
