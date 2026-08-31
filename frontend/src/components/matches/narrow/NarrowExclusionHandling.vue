<script setup lang="ts">
import type { useMatchesNarrow } from '@/composables/matches/narrow/useMatchesNarrow'

// Excluded matches — the same 3-way as Leavers, over matches the user gave a
// reason not to count (a placement, an MMR adjustment, a game lost to their
// own connection). The default is Drop from tally, not Include: writing the
// reason down IS the instruction, so the control exists to override it, not
// to switch it on. Chrome is global (narrow.css); no scoped styles.
type MatchesNarrowApi = ReturnType<typeof useMatchesNarrow>
const props = defineProps<{ narrow: MatchesNarrowApi }>()
const { exclusionHandling } = props.narrow
</script>

<template>
  <!-- Excluded matches -->
  <section class="np-section">
    <div class="np-section-head">
      <span class="eyebrow np-section-eyebrow">Excluded matches</span>
      <span class="np-section-meta">{{ exclusionHandling }}</span>
    </div>
    <div class="np-chips">
      <button class="np-chip" :class="{ picked: exclusionHandling === 'include' }" @click="exclusionHandling = 'include'">
        Count them
      </button>
      <button class="np-chip" :class="{ picked: exclusionHandling === 'exclude-tally' }" @click="exclusionHandling = 'exclude-tally'">
        Drop from tally
      </button>
      <button class="np-chip" :class="{ picked: exclusionHandling === 'hide' }" @click="exclusionHandling = 'hide'">
        Hide entirely
      </button>
    </div>
  </section>
</template>
