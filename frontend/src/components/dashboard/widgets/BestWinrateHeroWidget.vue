<script setup lang="ts">
import { useDossier } from '@/composables/dashboard/useDossier'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'
import { bestWinrateHeroSchema, type BestWinrateHeroConfig } from '@/dashboard/widgets'
import { DEFAULT_MOST_PLAYED_HERO_THRESHOLD } from '@/composables/matches/useMatchesDossier'

const dossier = useDossier()
const { config } = useWidgetConfig<BestWinrateHeroConfig>('best-winrate-hero', bestWinrateHeroSchema)

// `minPercentPlayed` shares the dossier-wide default — the
// percent-played gate is fundamentally about "is this attribution
// meaningful?", which is a different question from "is the sample
// large enough to trust the rate?" The widget only exposes the
// latter knob; the percent-played threshold stays at the dossier
// default. Power users can plumb it through later if needed.
const hero = dossier.bestWinrateHero(() => ({
  minPercentPlayed: DEFAULT_MOST_PLAYED_HERO_THRESHOLD,
  minMatches:       config.value.minMatches,
}))
</script>

<template>
  <span class="kpi-eyebrow">Best hero by winrate</span>
  <span class="kpi-value kpi-text">{{ hero?.key || '—' }}</span>
  <!-- Surfaces "83% in 6 matches" so the user reads both the winrate
       AND the sample that produced it. Hidden when no hero clears
       the qualification gates. -->
  <span v-if="hero" class="kpi-sub">
    {{ hero.winrate }}% in {{ hero.qualifyingMatches }} match<span v-if="hero.qualifyingMatches !== 1">es</span>
  </span>
</template>
