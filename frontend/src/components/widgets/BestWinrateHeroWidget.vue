<script setup lang="ts">
import type { BestWinrateHero } from '../../composables/useMatchesDossier'

defineProps<{
  hero: BestWinrateHero | null
}>()
</script>

<template>
  <span class="kpi-eyebrow">Best hero by winrate</span>
  <span class="kpi-value kpi-text">{{ hero?.key || '—' }}</span>
  <!-- Surfaces "83% in 6 matches" so the user reads both the winrate
       AND the sample that produced it. Hidden when no hero clears
       the qualification gate (≥ 20% percent_played + ≥ 3 decisive
       matches). -->
  <span v-if="hero" class="kpi-sub">
    {{ hero.winrate }}% in {{ hero.qualifyingMatches }} match<span v-if="hero.qualifyingMatches !== 1">es</span>
  </span>
</template>
