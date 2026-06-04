import { inject, provide, type InjectionKey } from 'vue'
import type { MatchesDossier } from './useMatchesDossier'

// Symbol-keyed inject token so widgets reach the dossier without
// threading 18 props through DashboardWidget. MatchesView provides
// the dossier once with `provideDossier(...)`; each widget calls
// `useDossier()` in its own `<script setup>` block and pulls only
// the slice it renders. Mirrors the Grafana panel pattern of
// "self-contained widgets querying a shared data source."
//
// Module-private — useDossier + provideDossier are the only intended
// consumers. PR B ships the helpers; PR C wires widgets to use them.
const DOSSIER_KEY: InjectionKey<MatchesDossier> = Symbol('recall.dossier')

// Convenience wrapper around Vue's inject so widget files don't
// have to import the InjectionKey symbol AND assert non-null at
// every call site. Throws on absent provider — a useful loud
// signal that the widget is being mounted outside MatchesView (e.g.
// in a test that forgot to provide a mock dossier).
export function useDossier(): MatchesDossier {
  const dossier = inject(DOSSIER_KEY)
  if (!dossier) {
    throw new Error(
      'useDossier() called outside a MatchesView provider. ' +
      'Either render the widget inside MatchesView, or call ' +
      'provideDossier(mockDossier) in your test setup.',
    )
  }
  return dossier
}

// Counterpart to useDossier. MatchesView calls this once during
// setup; widget tests can call it with a hand-built mock dossier
// to satisfy useDossier() without spinning up the real composable.
export function provideDossier(dossier: MatchesDossier): void {
  provide(DOSSIER_KEY, dossier)
}
