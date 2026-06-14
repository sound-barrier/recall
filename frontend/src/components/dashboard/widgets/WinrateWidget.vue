<script setup lang="ts">
import { useDossier } from '@/composables/dashboard/useDossier'

const { winrate } = useDossier()
</script>

<template>
  <span class="kpi-eyebrow">Winrate</span>
  <span class="kpi-value">{{ winrate !== null ? `${winrate}%` : '—' }}</span>
</template>
