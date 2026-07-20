<script setup lang="ts">
import { computed } from 'vue'
import { useDossier } from '@/composables/dashboard/useDossier'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'
import { heroDisciplineSchema, type HeroDisciplineConfig } from '@/dashboard/widgets'

// Hero pool size — the DERIVED pool's member count (heroes with at least
// max(5, 10% of decisive games) meaningful decisive games), not a raw count
// of every hero ever touched: the same definition the Hero pool widget and
// the Compare rows use, so the numbers agree across the app.

const dossier = useDossier()
const { config } = useWidgetConfig<HeroDisciplineConfig>('hero-pool-size', heroDisciplineSchema)

const analysis = dossier.heroPool(() => ({ thresholdPct: config.value.thresholdPct }))

const size = computed(() => analysis.value.pool.length)

// A glanceable roster: first three pool members, "+N" for the rest.
const names = computed(() => {
  const keys = analysis.value.pool.map((p) => p.key)
  if (keys.length <= 3) return keys.join(', ')
  return `${keys.slice(0, 3).join(', ')} +${keys.length - 3}`
})
const fullRoster = computed(() => analysis.value.pool.map((p) => p.key).join(', '))
</script>

<template>
  <span class="eyebrow kpi-eyebrow">Hero pool size</span>
  <span class="kpi-value">{{ size > 0 ? size : '—' }}</span>
  <span v-if="size > 0" class="kpi-sub" :title="fullRoster">{{ names }}</span>
  <span v-else class="kpi-sub">no pool yet</span>
</template>
