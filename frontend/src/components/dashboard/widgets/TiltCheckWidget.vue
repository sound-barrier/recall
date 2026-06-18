<script setup lang="ts">
// Tilt check — win-rate in the game immediately after a loss, with the
// after-a-win baseline as the comparison. A gap below the baseline is
// the tilt signal. Opt-in.
import { useDossier } from '@/composables/dashboard/useDossier'

const { winrateAfterLoss, winrateAfterWin } = useDossier()
</script>

<template>
  <span class="kpi-eyebrow">Win-rate after a loss</span>
  <span class="kpi-value">{{ winrateAfterLoss.winrate === null ? '—' : winrateAfterLoss.winrate + '%' }}</span>
  <span v-if="winrateAfterLoss.winrate !== null && winrateAfterWin.winrate !== null" class="kpi-sub">
    vs {{ winrateAfterWin.winrate }}% after a win · {{ winrateAfterLoss.sample }} game<span v-if="winrateAfterLoss.sample !== 1">s</span>
  </span>
</template>
