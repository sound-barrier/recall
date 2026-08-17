<script setup lang="ts">
// How fast the rank is actually moving, in units the player experiences: a
// session and a week, rather than a per-match average nobody feels.
//
// Null rather than zero when nothing reported a movement — an unknown rate is
// not a stalled climb, and the difference is the whole point of this campaign.
import { computed } from 'vue'
import { useDossier } from '@/composables/dashboard/useDossier'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'
import { climbVelocitySchema, type ClimbVelocityConfig } from '@/dashboard/widgets'
import { signJudgment } from '@/match/trends/match-heatmap-helpers'

const dossier = useDossier()
const { config } = useWidgetConfig<ClimbVelocityConfig>('climb-velocity', climbVelocitySchema)
const velocity = dossier.velocity(() => ({ days: config.value.days }))

const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}%`

const headline = computed(() => {
  const per = velocity.value.perWeek
  return per === null ? '—' : `${signed(per)}/wk`
})
const tint = computed(() => {
  const per = velocity.value.perWeek
  if (per === null || per === 0) return ''
  return per > 0 ? 'tint-up' : 'tint-down'
})
const spokenName = computed(() => {
  const per = velocity.value.perWeek
  return per === null ? undefined : `${headline.value} — ${signJudgment(per)}`
})

const detail = computed(() => {
  const v = velocity.value
  if (v.readCount === 0) {
    return 'No rank movement was read in this window.'
  }
  const perSession = v.perSession === null ? null : `${signed(v.perSession)}/session`
  return [perSession, `${v.readCount} readings`].filter(Boolean).join(' · ')
})
</script>

<template>
  <span class="eyebrow kpi-eyebrow">Climb rate</span>
  <span class="kpi-value" :class="tint" role="img" :aria-label="spokenName">{{ headline }}</span>
  <span class="kpi-sub">{{ detail }}</span>
</template>
