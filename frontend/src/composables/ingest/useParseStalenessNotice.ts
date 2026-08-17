import { computed, type Ref } from 'vue'

import { profileScopedKey } from '@/composables/profile/profileStorage'
import { usePersistedRef, parseClampedNumber } from '@/composables/shared/usePersistedRef'
import { useWriteGate } from '@/composables/shared/useWriteGate'
import { useMatchesStore } from '@/stores/matches'
import { useParseStore } from '@/stores/parse'

// NOT_DISMISSED is below every real generation, so a fresh install shows the
// notice. 0 would collide with the "no answer yet" default the store returns
// before the first response.
const NOT_DISMISSED = -1

// useParseStalenessNotice decides whether to tell the user that some of their
// matches were read by an older parser.
//
// The dismissal is keyed on the GENERATION, not on a timestamp or a boolean,
// and that choice carries the whole design:
//
//   - A dismissal must be possible at all. A user whose original screenshots
//     are no longer on disk can never drive the count to zero, so a
//     non-dismissible notice would nag forever with no action that could clear
//     it — the definition of an alarm people learn to ignore.
//   - But it must not be permanent. Keying on the generation means the NEXT
//     parser improvement re-raises the notice exactly once, which is the only
//     moment it carries new information.
//
// Profile-scoped because the count is per-database: a second profile has its
// own history and its own answer, the same reason lastParsedAt is scoped.
export function useParseStalenessNotice(): {
  staleMatches: Readonly<Ref<number>>
  shouldShow: Readonly<Ref<boolean>>
  dismiss: () => void
} {
  const parse = useParseStore()
  const matches = useMatchesStore()
  const { sessionActive } = useWriteGate()

  const { value: dismissedGeneration, set: setDismissed } = usePersistedRef<number>({
    key: profileScopedKey('staleParseDismissedGeneration'),
    defaultValue: NOT_DISMISSED,
    parse: parseClampedNumber(NOT_DISMISSED, Number.MAX_SAFE_INTEGER),
  })

  const staleMatches = computed(() => parse.staleMatches)

  const shouldShow = computed(() =>
    parse.staleMatches > 0
    && parse.parserGeneration > dismissedGeneration.value
    // A coaching session is someone else's data on screen; nagging the coach
    // about the owner's parse vintage is noise they cannot act on. The tour is
    // showing synthetic records, where the count means nothing at all.
    && !sessionActive.value
    && !matches.tourActive)

  function dismiss(): void {
    setDismissed(parse.parserGeneration)
  }

  return { staleMatches, shouldShow, dismiss }
}
