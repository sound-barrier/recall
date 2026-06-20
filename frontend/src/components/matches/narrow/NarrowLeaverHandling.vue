<script setup lang="ts">
import type { useMatchesNarrow } from '@/composables/matches/useMatchesNarrow'

// Leaver handling — a single-select 3-way over how matches that carried a leaver
// count toward the W/L tally: Include them, Drop from tally (keep the row, skip
// the W/L), or Hide entirely. Writes leaverHandling on the shared narrow bundle.
// Distinct from the "With a leaver" facet, which scopes the SET by leaver side.
// Chrome is global (narrow.css); no scoped styles.
type MatchesNarrowApi = ReturnType<typeof useMatchesNarrow>
const props = defineProps<{ narrow: MatchesNarrowApi }>()
const { leaverHandling } = props.narrow
</script>

<template>
  <!-- Leavers -->
  <section class="np-section">
    <div class="np-section-head">
      <span class="np-section-eyebrow">Leavers</span>
      <span class="np-section-meta">{{ leaverHandling }}</span>
    </div>
    <div class="np-chips">
      <button class="np-chip" :class="{ picked: leaverHandling === 'include' }" @click="leaverHandling = 'include'">
        Include
      </button>
      <button class="np-chip" :class="{ picked: leaverHandling === 'exclude-tally' }" @click="leaverHandling = 'exclude-tally'">
        Drop from tally
      </button>
      <button class="np-chip" :class="{ picked: leaverHandling === 'hide' }" @click="leaverHandling = 'hide'">
        Hide entirely
      </button>
    </div>
  </section>
</template>
