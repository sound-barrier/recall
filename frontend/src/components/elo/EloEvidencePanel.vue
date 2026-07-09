<script setup lang="ts">
import type { EvidenceItem } from '@/composables/elo/useEloEvidence'

// "What actually moves your rank" — the levers you control, measured from your
// own games: reviewing, hero-pool discipline, tilt. The constructive half of
// the anti-"Elo Hell" case. One typed prop (Law of Demeter).
defineProps<{ items: EvidenceItem[] }>()
</script>

<template>
  <section v-if="items.length > 0" class="elo-band" aria-labelledby="elo-evidence-title">
    <h3 id="elo-evidence-title" class="elo-band-title">
      What actually moves your rank
    </h3>
    <p class="elo-band-sub">
      The levers you control — measured from your own games, not guesses.
    </p>
    <div class="elo-grid">
      <div v-for="item in items" :key="item.id" class="elo-cell" :class="item.tone" :data-elo-evidence="item.id">
        <p class="elo-cell-q">
          {{ item.label }}
        </p>
        <p class="elo-cell-a">
          {{ item.value }}
          <span v-if="item.lowSample" class="elo-lown" title="Small sample — treat as noisy">n&lt;5</span>
        </p>
        <p class="elo-cell-note">
          {{ item.gloss }}
        </p>
      </div>
    </div>
  </section>
</template>
