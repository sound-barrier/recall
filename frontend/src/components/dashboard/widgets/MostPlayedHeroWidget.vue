<script setup lang="ts">
import { useDossier } from '@/composables/useDossier'
import { useWidgetConfig } from '@/composables/useWidgetConfig'
import { mostPlayedHeroSchema, type MostPlayedHeroConfig } from '@/dashboard/widgets'

const dossier = useDossier()
const { config } = useWidgetConfig<MostPlayedHeroConfig>('most-played-hero', mostPlayedHeroSchema)

// Two reactive queries — the hero name comes from the time-ranked
// leader, the winrate annotation from the threshold-gated count.
// Both share the same useDossier handle so they pull from one
// records walk per computed dep.
const topHero = dossier.topHeroesByMinutes({ limit: 1 })
const mostPlayedHero = dossier.mostPlayedHero(() => ({
  minPercentPlayed: config.value.minPercentPlayed,
}))
</script>

<template>
  <span class="kpi-eyebrow">Most played hero</span>
  <span class="kpi-value kpi-text">{{ topHero[0]?.key || '—' }}</span>
  <!-- Win-rate for the time-ranked top hero, computed over matches
       where their percent_played cleared the user-tunable threshold
       (sub-threshold flex picks would otherwise drag the rate
       around). Surfaces "67% in 3 matches" so the user reads both
       the number and what fed it. Hidden when no decisive qualifying
       matches exist (winrate=null) — the hero name still shows. -->
  <span
    v-if="mostPlayedHero?.winrate !== null && mostPlayedHero?.winrate !== undefined"
    class="kpi-sub"
  >
    {{ mostPlayedHero.winrate }}% in {{ mostPlayedHero.qualifyingMatches }} match<span v-if="mostPlayedHero.qualifyingMatches !== 1">es</span>
  </span>
</template>
