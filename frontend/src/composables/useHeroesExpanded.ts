import { usePersistedRef, parseBoolish, serializeBoolish } from './usePersistedRef'

export const HEROES_EXPANDED_STORAGE_KEY = 'recall.heroesExpanded'

// Persisted preference for whether the Heroes Played block inside an
// expanded match card defaults to open or collapsed. Default true
// (open) to preserve the long-standing behaviour; users with very
// long match histories collapse it once and the choice survives
// every subsequent card open.
//
// Per-card state would be tempting, but expanded cards are destroyed
// on collapse — there's nothing local to persist across. Global is
// the right scope.

export function useHeroesExpanded() {
  const { value: heroesExpanded, set: setHeroesExpanded } = usePersistedRef<boolean>({
    key: HEROES_EXPANDED_STORAGE_KEY,
    defaultValue: true,
    parse: parseBoolish,
    serialize: serializeBoolish,
  })
  function toggleHeroesExpanded() { setHeroesExpanded(!heroesExpanded.value) }
  return { heroesExpanded, setHeroesExpanded, toggleHeroesExpanded }
}
