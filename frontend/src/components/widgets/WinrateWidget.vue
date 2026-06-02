<script setup lang="ts">
defineProps<{
  winrate: number | null
}>()
</script>

<template>
  <span class="kpi-eyebrow">Winrate</span>
  <span class="kpi-value">{{ winrate !== null ? `${winrate}%` : '—' }}</span>
</template>
