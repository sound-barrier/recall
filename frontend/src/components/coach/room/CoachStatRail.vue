<script setup lang="ts">
import type { RailTendency } from '@/match/coach/coach-rail-helpers'
import { useOWData } from '@/composables/shared/useOWData'

// What this player usually does on the hero and map in front of the coach.
//
// It lives beside the sheet rather than on the desk because the desk is
// where the coach WRITES; this is reference, and reference that moves the
// note field down the page is worse than no reference. It follows the
// frame, so a coach walking the reel never asks for it.
defineProps<{ rows: RailTendency[] }>()

// Stored names are lowercase; the roster is the one place that knows how
// each is actually spelled ("Soldier: 76", "King's Row").
const ow = useOWData()

// "On Ana" / "On King's Row" — the preposition is what makes the row read
// as a claim about the player rather than a label on a bucket.
function heading(row: RailTendency): string {
  const name = row.dimension === 'hero' ? ow.heroDisplayName(row.key) : ow.mapDisplayName(row.key)
  return `On ${name || row.key}`
}

// The number is a rate; whether it MEANS anything is the sample. A bundle is
// six matches, so most buckets here are one or two games and the honest
// answer is to say so rather than print 100%.
function sampleNote(row: RailTendency): string {
  if (row.winrate === null) return 'nothing decided yet'
  const games = `${row.w + row.l} decided`
  return row.lowSample ? `${games} · too few to read` : games
}

function eadLine(row: RailTendency): string {
  if (row.elims === null) return 'no stat readings'
  return `${row.elims} E · ${row.assists} A · ${row.deaths} D`
}

</script>

<template>
  <section class="paper coach-rail" aria-label="Player tendencies">
    <p class="eyebrow ink coach-rail-eyebrow">
      In this player's history
    </p>
    <div v-for="row in rows" :key="`${row.dimension}-${row.key}`" class="coach-rail-row">
      <p class="coach-rail-head">
        {{ heading(row) }}
      </p>
      <div class="coach-rail-bar">
        <div
          v-if="row.winrate !== null"
          class="coach-rail-fill"
          role="progressbar"
          :aria-label="`${row.key} winrate`"
          :aria-valuenow="row.winrate"
          aria-valuemin="0"
          aria-valuemax="100"
          :style="{ width: `${row.winrate}%` }"
        />
        <span class="coach-rail-rate">{{ row.winrate === null ? '—' : `${row.winrate}%` }}</span>
      </div>
      <p class="coach-rail-note">
        {{ sampleNote(row) }} · {{ eadLine(row) }}
      </p>
    </div>
  </section>
</template>

<style scoped>
/* On paper with the sheet it sits above — this is part of the session's own
   stationery, not app chrome that happens to be nearby. */
.coach-rail {
  padding: 0.75rem 0.9rem;
  margin-bottom: 0.75rem;
}

.coach-rail-eyebrow { margin: 0 0 0.5rem; }

.coach-rail-row + .coach-rail-row {
  margin-top: 0.7rem;
  padding-top: 0.7rem;
  border-top: 1px solid var(--hairline);
}

.coach-rail-head {
  margin: 0 0 0.3rem;
  font-size: var(--type-sm);
}

/* The track holds the printed rate, so it must stay in the a11y tree — the
   progressbar role goes on the FILL, never here. */
.coach-rail-bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: 1.1rem;
}

.coach-rail-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--paper-accent);
  opacity: 0.22;
  border-radius: var(--radius-hair);
}

.coach-rail-rate {
  position: relative;
  font-family: var(--mono);
  font-size: var(--type-sm);
  font-variant-numeric: tabular-nums;
}

.coach-rail-note {
  margin: 0.25rem 0 0;
  font-size: var(--type-2xs);
  opacity: 0.75;
}
</style>
