<script setup lang="ts">
// The climb rate in SR — the currency, not the meter.
//
// The `climb-velocity` tile beside this one counts change_percent, which is
// what almost every rank screen reports. This counts data.sr[].change, which
// is read far less often and is what the player actually banks. Both ship,
// because replacing the meter one would blank a working card for anybody
// whose captures do not carry SR.
import { computed } from 'vue'
import { useDossier } from '@/composables/dashboard/useDossier'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'
import { climbVelocitySchema, type ClimbVelocityConfig } from '@/dashboard/widget-schemas'
import { signJudgment } from '@/match/trends/match-heatmap-helpers'

const dossier = useDossier()
const { config } = useWidgetConfig<ClimbVelocityConfig>('sr-climb-rate', climbVelocitySchema)
const rate = dossier.srClimbRate(() => ({ days: config.value.days }))

const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}`

const headline = computed(() => {
  const per = rate.value.perWeek
  return per === null ? '—' : `${signed(per)} SR/wk`
})
const tint = computed(() => {
  const per = rate.value.perWeek
  if (per === null || per === 0) return ''
  return per > 0 ? 'tint-up' : 'tint-down'
})
const spokenName = computed(() => {
  const per = rate.value.perWeek
  return per === null ? undefined : `${headline.value} — ${signJudgment(per)}`
})

const detail = computed(() => {
  const v = rate.value
  if (v.readCount === 0) return 'No SR readings in this window.'
  const perSession = v.perSession === null ? null : `${signed(v.perSession)}/session`
  return [perSession, `${v.readCount} readings`].filter(Boolean).join(' · ')
})
</script>

<template>
  <span class="eyebrow kpi-eyebrow">SR climb rate</span>
  <span
    class="kpi-value"
    :class="tint"
    :role="spokenName ? 'img' : undefined"
    :aria-label="spokenName"
  >{{ headline }}</span>
  <span class="kpi-sub">{{ detail }}</span>
</template>
