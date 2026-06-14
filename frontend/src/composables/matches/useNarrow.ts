import { inject, provide, type InjectionKey } from 'vue'
import type { useMatchesNarrow } from '@/composables/matches/useMatchesNarrow'

// Provide/inject seam for the Matches-view narrow state. Mirrors
// useDossier exactly so widgets that need to mutate the active
// filter set (heatmap cell clicks, etc.) can reach the pick handlers
// without prop-drilling through DashboardWidget.
//
// Use sparingly: most widgets render a passive view of the dossier
// and don't touch narrow. The heatmap is the first widget that does
// — clicking a cell narrows the active set to (hero, gameMode) so the
// user can drill into the matches that produced the surface signal
// without leaving the page.

export type NarrowApi = ReturnType<typeof useMatchesNarrow>

export const NARROW_KEY: InjectionKey<NarrowApi> = Symbol('recall.narrow')

export function useNarrow(): NarrowApi {
  const narrow = inject(NARROW_KEY)
  if (!narrow) {
    throw new Error(
      'useNarrow() called outside a MatchesView provider. ' +
      'Either render the widget inside MatchesView, or call ' +
      'provideNarrow(mockNarrow) in your test setup.',
    )
  }
  return narrow
}

export function provideNarrow(narrow: NarrowApi): void {
  provide(NARROW_KEY, narrow)
}
