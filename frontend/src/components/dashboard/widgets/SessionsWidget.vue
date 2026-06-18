<script setup lang="ts">
// Play sessions — count of distinct sessions in the set (runs of
// matches separated by a multi-hour gap). Opt-in.
import { useDossier } from '@/composables/dashboard/useDossier'

const { sessions } = useDossier()
</script>

<template>
  <span class="kpi-eyebrow">Play sessions</span>
  <span class="kpi-value">{{ sessions }}</span>
</template>
