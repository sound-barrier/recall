<script setup lang="ts">
import { useDossier } from '../../composables/useDossier'

const { heroPoolSize: size } = useDossier()
</script>

<template>
  <span class="kpi-eyebrow">Hero pool size</span>
  <span class="kpi-value">{{ size > 0 ? size : '—' }}</span>
  <span v-if="size > 0" class="kpi-sub">
    unique hero<span v-if="size !== 1">es</span>
  </span>
</template>
