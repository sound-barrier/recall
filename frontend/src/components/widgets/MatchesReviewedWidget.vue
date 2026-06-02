<script setup lang="ts">
import type { ReviewedCount } from '../../composables/useMatchesDossier'

defineProps<{
  reviewedCount: ReviewedCount
}>()
</script>

<template>
  <span class="kpi-eyebrow">Matches reviewed</span>
  <!-- Headline is the raw reviewed count; subtitle is the share
       against the full narrow so the user reads BOTH the absolute
       volume AND the workflow ratio. We render '—' when the narrow
       is empty so the value cell never degrades to a bare "0". -->
  <span class="kpi-value">{{ reviewedCount.total === 0 ? '—' : reviewedCount.reviewed }}</span>
  <span v-if="reviewedCount.total > 0" class="kpi-sub">
    {{ reviewedCount.percent }}% of {{ reviewedCount.total }} match<span v-if="reviewedCount.total !== 1">es</span>
  </span>
</template>
