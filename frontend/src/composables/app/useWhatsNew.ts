import { usePersistedRef } from '@/composables/shared/usePersistedRef'

// The what's-new strip's one-time gate. The tour only runs on first boot,
// so a feature shipped to an EXISTING install has no surface that says it
// exists — the 07 Reviews tab sat unannounced behind a tab number. One
// feature, one key, one sentence; taking the pointer or dismissing it is
// permanent for that feature, and the next announced feature gets its own
// key so a dismissal never mutes the one after it.

const SEEN = 'seen'

export function useWhatsNew(featureKey: string) {
  const { value: state, set } = usePersistedRef<string>({
    key: `recall.whatsNew.${featureKey}`,
    defaultValue: '',
    parse: (raw) => raw,
  })
  return {
    unseen: () => state.value !== SEEN,
    markSeen: () => set(SEEN),
  }
}
