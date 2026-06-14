<script setup lang="ts">
import { useDossier } from '@/composables/dashboard/useDossier'

const { daysSinceLastReview } = useDossier()
</script>

<template>
  <span class="kpi-eyebrow">Days since last review</span>
  <!-- 0 days reads as "today" — the units cell would otherwise be
       misleading (a review three hours ago is not "0 days"
       colloquially). Tile carries a title attribute with the precise
       ISO timestamp so power users can hover for exact recency.
       Em-dash when the narrow has no reviewed matches. -->
  <span class="kpi-value" :title="daysSinceLastReview.lastReviewedAt ?? undefined">
    {{ daysSinceLastReview.days === null
      ? '—'
      : daysSinceLastReview.days === 0
        ? 'Today'
        : daysSinceLastReview.days }}
  </span>
  <span
    v-if="daysSinceLastReview.days !== null && daysSinceLastReview.days >= 1"
    class="kpi-sub"
  >
    day<span v-if="daysSinceLastReview.days !== 1">s</span> ago
  </span>
</template>
