<script setup lang="ts">
// After N+ losses — win rate of the games that follow a losing streak,
// against the overall baseline. The stop-loss signal: when this sits
// well under baseline, the queue after back-to-back losses is where
// rank leaks. Sharper than the single-loss tilt check. Gallery opt-in.
import { useDossier } from '@/composables/dashboard/useDossier'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'
import { lossStreakRecoverySchema, type LossStreakRecoveryConfig } from '@/dashboard/widgets'

const dossier = useDossier()
const { config } = useWidgetConfig<LossStreakRecoveryConfig>('loss-streak-recovery', lossStreakRecoverySchema)
const recovery = dossier.lossStreakRecovery(() => ({ minStreak: config.value.minStreak }))
const { winrate } = dossier
</script>

<template>
  <span class="eyebrow kpi-eyebrow">After {{ config.minStreak }}+ losses</span>
  <span class="kpi-value">{{ recovery.winrate === null ? '—' : `${recovery.winrate}%` }}</span>
  <!-- "n=" mirrors the Winrate tile's sample vocabulary. -->
  <span v-if="recovery.winrate !== null" class="kpi-sub">
    <template v-if="winrate !== null">vs {{ winrate }}% overall · </template>n={{ recovery.sample }}
  </span>
</template>
