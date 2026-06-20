import { inject, provide, type InjectionKey } from 'vue'
import type { MatchesDossier } from '@/composables/matches/useMatchesDossier'

// Symbol-keyed inject token so widgets reach the dossier without
// threading 18 props through DashboardWidget. MatchesView provides
// the dossier once with `provideDossier(...)`; each widget calls
// `useDossier()` in its own `<script setup>` block and pulls only
// the slice it renders. Mirrors the dashboard-panel pattern of
// "self-contained widgets querying a shared data source."
//
// Exported so widget tests can provide a mock dossier via vue-test-
// utils' `global.provide: { [DOSSIER_KEY]: mockDossier }`. Outside
// tests, prefer `provideDossier(d)` and `useDossier()` — they're
// the typed surface.
export const DOSSIER_KEY: InjectionKey<MatchesDossier> = Symbol('recall.dossier')

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

// The dossier built over the UNFILTERED record set (it ignores the active
// narrow), so a widget/band can size its STRUCTURE — which rows to show, how
// many rows to reserve — stably while its DATA stays on the narrowed
// useDossier(). This is what keeps the Geography grid from collapsing when its
// own cell-pick narrows the set, and what lets the top-N widgets reserve to the
// real item count instead of a fixed limit.
export const FULL_DOSSIER_KEY: InjectionKey<MatchesDossier> = Symbol('recall.dossier.full')

// Falls back to the narrowed dossier when no full one is provided (widget tests
// that stub only DOSSIER_KEY, or any non-MatchesView host) — callers that read
// only data are unaffected.
export function useFullDossier(): MatchesDossier {
  return inject(FULL_DOSSIER_KEY) ?? useDossier()
}

export function provideFullDossier(dossier: MatchesDossier): void {
  provide(FULL_DOSSIER_KEY, dossier)
}

// "Narrow minus self" dossiers — a band's DATA reads everything EXCEPT its own
// filter dimension, so the bands indirectly affect each other (selecting in one
// updates the other) without a band collapsing from its own selection. Geography
// drops its maps/roles; Hero×Game-Mode drops its heroes/game-modes. Both fall back
// to the full dossier when not provided (widget tests / non-MatchesView hosts).
const GEOGRAPHY_DOSSIER_KEY: InjectionKey<MatchesDossier> = Symbol('recall.dossier.geography')
const HERO_MODE_DOSSIER_KEY: InjectionKey<MatchesDossier> = Symbol('recall.dossier.heroMode')

export function useGeographyDossier(): MatchesDossier {
  return inject(GEOGRAPHY_DOSSIER_KEY) ?? useFullDossier()
}
export function provideGeographyDossier(dossier: MatchesDossier): void {
  provide(GEOGRAPHY_DOSSIER_KEY, dossier)
}

export function useHeroModeDossier(): MatchesDossier {
  return inject(HERO_MODE_DOSSIER_KEY) ?? useFullDossier()
}
export function provideHeroModeDossier(dossier: MatchesDossier): void {
  provide(HERO_MODE_DOSSIER_KEY, dossier)
}
