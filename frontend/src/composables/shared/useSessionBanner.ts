import { usePersistedRef, parseBoolish } from '@/composables/shared/usePersistedRef'

export const SESSION_BANNER_STORAGE_KEY = 'recall.sessionBanner'

// Persisted preference for the live session banner.
//
// Default OFF, deliberately. The masthead scoreboard, the by-session
// grouping, the dossier and the summary toast all already spell a session
// tally; this one adds the ladder position on top. That is worth having and
// it is still a fifth surface, so it is the player's to switch on rather than
// ours to put in front of everyone.
export function useSessionBanner() {
  const { value: sessionBanner, set: setSessionBanner } = usePersistedRef<boolean>({
    key: SESSION_BANNER_STORAGE_KEY,
    defaultValue: false,
    parse: parseBoolish,
  })
  return { sessionBanner, setSessionBanner }
}
