<script setup lang="ts">
import type { HeroBreakdownEntry, MostPlayedHero } from '../../composables/useMatchesDossier'

defineProps<{
  topHeroes: readonly HeroBreakdownEntry[]
  mostPlayedHero: MostPlayedHero | null
}>()
</script>

<template>
  <span class="kpi-eyebrow">Most played hero</span>
  <span class="kpi-value kpi-text">{{ topHeroes[0]?.key || '—' }}</span>
  <!-- Win-rate for the time-ranked top hero, computed over matches
       where their percent_played cleared the 20% threshold (sub-
       threshold flex picks would otherwise drag the rate around).
       Surfaces "67% in 3 matches" so the user reads both the number
       and what fed it. Hidden when no decisive qualifying matches
       exist (winrate=null) — the hero name still shows. -->
  <span
    v-if="mostPlayedHero?.winrate !== null && mostPlayedHero?.winrate !== undefined"
    class="kpi-sub"
  >
    {{ mostPlayedHero.winrate }}% in {{ mostPlayedHero.qualifyingMatches }} match<span v-if="mostPlayedHero.qualifyingMatches !== 1">es</span>
  </span>
</template>
