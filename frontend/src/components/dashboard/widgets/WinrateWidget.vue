<script setup lang="ts">
import { computed } from 'vue'
import { useDossier } from '@/composables/dashboard/useDossier'
import { wilsonMargin } from '@/match/dossier/match-sample-helpers'

const { winrate, wld } = useDossier()

// Wilson 95% half-width over the decisive tally — the sample-size
// honesty line under the headline rate.
const ci = computed(() => {
  const decisive = wld.value.w + wld.value.l
  const margin = wilsonMargin(wld.value.w, decisive)
  if (margin === null) return null
  return { margin, n: decisive }
})
</script>

<template>
  <span class="eyebrow kpi-eyebrow">Winrate</span>
  <span class="kpi-value">{{ winrate !== null ? `${winrate}%` : '—' }}</span>
  <span v-if="ci" class="kpi-sub winrate-ci">± {{ ci.margin }} pts · n={{ ci.n }}</span>
</template>
