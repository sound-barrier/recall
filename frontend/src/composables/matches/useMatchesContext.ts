import {
  provideDossier, provideFullDossier, provideGeographyDossier, provideHeroModeDossier,
} from '@/composables/dashboard/useDossier'
import { provideNarrow } from '@/composables/matches/narrow/useNarrow'
import type { useMatchesStore } from '@/stores/matches'

/**
 * Provide every bundle the Matches widgets inject.
 *
 * Widgets reach these through useDossier() / useNarrow() rather than through
 * eighteen props threaded down DashboardWidget, and WHICH bundle a widget
 * reads is a real distinction:
 *
 *   - dossier          — the narrowed set. What a widget's numbers are ABOUT.
 *   - fullDossier      — the unfiltered corpus, for STRUCTURE: stable row sets
 *                        and reserve counts, so a widget does not reflow its
 *                        own shape every time the narrow changes.
 *   - geography /      — narrow-minus-self, each excluding its own filter
 *     heroMode           dimension, so those two bands affect each other
 *                        without collapsing from their own selection.
 *   - matchesNarrow    — the handlers, for widgets that drill into a slice.
 *
 * Collected here because that list is one decision about how the widget tree
 * gets its data, and because the view that renders the tree does not make it.
 */
export function provideMatchesContext(store: ReturnType<typeof useMatchesStore>): void {
  provideDossier(store.dossier)
  provideFullDossier(store.fullDossier)
  provideGeographyDossier(store.geographyDossier)
  provideHeroModeDossier(store.heroModeDossier)
  provideNarrow(store.matchesNarrow)
}
