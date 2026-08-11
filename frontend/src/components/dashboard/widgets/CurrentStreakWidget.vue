<script setup lang="ts">
import { computed } from 'vue'
import { useDossier } from '@/composables/dashboard/useDossier'
import { resultJudgment } from '@/match/match-heatmap-helpers'

const { currentStreak: streak } = useDossier()

type StreakResult = 'victory' | 'defeat' | 'draw'

const STREAK_TINT: Record<StreakResult, string> = {
  victory: 'kpi-streak-win',
  defeat:  'kpi-streak-loss',
  draw:    'kpi-streak-draw',
}
const STREAK_LETTER: Record<StreakResult, string> = { victory: 'W', defeat: 'L', draw: 'D' }

const result = computed<StreakResult | null>(() => streak.value.result)
const text = computed(() => (result.value ? `${streak.value.count}${STREAK_LETTER[result.value]}` : '—'))

// The tint is the whole verdict for a sighted player; role="img" plus
// the shared band word puts it in the accessible name too, so a screen
// reader or a colorblind player gets the same reading (WCAG 1.4.1).
const spokenName = computed(() =>
  (result.value ? `${text.value} — ${resultJudgment(result.value)}` : undefined))
</script>

<template>
  <span class="eyebrow kpi-eyebrow">Current streak</span>
  <span
    class="kpi-value"
    :class="result ? STREAK_TINT[result] : undefined"
    :role="result ? 'img' : undefined"
    :aria-label="spokenName"
  >{{ text }}</span>
  <span v-if="streak.sinceDate" class="kpi-sub">since {{ streak.sinceDate }}</span>
</template>

<style scoped>
/* Per-result coloring picks up the existing palette tokens so the
   streak reads in the matching W/L/D voice regardless of theme. */
.kpi-streak-win  { color: var(--win); }
.kpi-streak-loss { color: var(--loss); }
.kpi-streak-draw { color: var(--draw, var(--text-dim)); }
</style>
