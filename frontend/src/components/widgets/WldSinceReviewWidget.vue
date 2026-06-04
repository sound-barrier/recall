<script setup lang="ts">
import { useDossier } from '../../composables/useDossier'

const { wldSinceLastReview } = useDossier()
</script>

<template>
  <span class="kpi-eyebrow">W / L / D since last review</span>
  <!-- Three slash-separated counts mirror the avg-K/D/A tile's tri-
       value layout so the eye reads them as one composite stat.
       Em-dash when nothing has been reviewed yet (no anchor to count
       "since" from); a zero-zero-zero shape when the anchor exists
       but no new matches have come in (the subtitle then surfaces
       "0 new matches" so the user knows it's not stale data but an
       empty window). Title-tip carries the anchor ISO so power users
       can hover for the precise pivot point. -->
  <span
    class="kpi-value kda-value"
    :title="wldSinceLastReview?.referenceAt ?? undefined"
  >
    {{ wldSinceLastReview === null
      ? '—'
      : `${wldSinceLastReview.w} / ${wldSinceLastReview.l} / ${wldSinceLastReview.d}` }}
  </span>
  <span v-if="wldSinceLastReview !== null" class="kpi-sub">
    {{ wldSinceLastReview.total }} new match<span v-if="wldSinceLastReview.total !== 1">es</span>
  </span>
</template>
