<script setup lang="ts">
// SR movement split by the hero that earned it.
//
// SR is banked per role in this game, so one net figure can read flat while a
// support climbed and a tank slid — which is exactly the situation a player
// needs to see. The bar is the SHARE of the window's movement; the number
// beside it is where that hero actually stands.
import { computed } from 'vue'
import { useDossier } from '@/composables/dashboard/useDossier'

const dossier = useDossier()
const rows = dossier.srByRole()

const widest = computed(() =>
  Math.max(1, ...rows.value.map((r) => Math.abs(r.net))))

const signed = (v: number) => `${v > 0 ? '+' : ''}${v}`
</script>

<template>
  <header class="breakdown-head">
    <span class="eyebrow accent breakdown-eyebrow">SR by role</span>
  </header>
  <p v-if="rows.length === 0" class="kpi-sub">
    No SR readings in this set.
  </p>
  <ul v-else>
    <li v-for="row in rows" :key="row.hero">
      <span class="bd-name">{{ row.hero }}</span>
      <span class="bd-bar">
        <span
          class="bd-fill"
          :class="row.net >= 0 ? 'tint-up' : 'tint-down'"
          role="progressbar"
          :aria-valuenow="Math.abs(row.net)"
          aria-valuemin="0"
          :aria-valuemax="widest"
          :aria-label="`${row.hero} SR movement`"
          :style="{ width: (Math.abs(row.net) / widest) * 100 + '%' }"
        />
        <span class="bd-time">{{ row.readCount }}x</span>
      </span>
      <span class="bd-stats">{{ signed(row.net) }} · {{ row.latest }}</span>
    </li>
  </ul>
</template>
