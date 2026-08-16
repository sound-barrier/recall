<script setup lang="ts">
import { computed } from 'vue'

import type { MatchRecord } from '@/api-client'
import CoachReelDay from '@/components/coach/CoachReelDay.vue'
import { DEFAULT_COACH_LABELS, type CoachLabels } from '@/components/coach/coach-room-props'
import type { CoachNoteDraft } from '@/match/coach-notes'
import type { ReelDay } from '@/match/coach-reel-helpers'
import { playerClockNote, playerClockOwner } from '@/match/match-time-helpers'

// The film strip: the player's matches, her days newest first, each
// frame a click target. The list is named for her AND for whose clock
// the times are in — the room shows player-naive times everywhere, and
// an unlabeled 21:14 is a lie to a coach in another timezone.

const props = withDefaults(defineProps<{
  handle: string
  days: ReelDay<MatchRecord>[]
  selectedKey: string
  notes: Record<string, CoachNoteDraft>
  labels?: CoachLabels
}>(), { labels: () => DEFAULT_COACH_LABELS })

const emit = defineEmits<{ select: [matchKey: string] }>()

const reelLabel = computed(() => {
  const owner = playerClockOwner(props.handle)
  return `${owner}'s matches — times in ${owner}'s clock`
})
</script>

<template>
  <div class="coach-reel">
    <header class="reel-head">
      <h2 class="eyebrow accent reel-title">
        The reel
      </h2>
      <p class="reel-clock">
        {{ playerClockNote(handle) }}
      </p>
    </header>
    <ol v-if="days.length" class="reel-strip" :aria-label="reelLabel">
      <CoachReelDay
        v-for="day in days"
        :key="day.dayKey"
        :day="day"
        :selected-key="selectedKey"
        :notes="notes"
        :labels="labels"
        @select="(matchKey: string) => emit('select', matchKey)"
      />
    </ol>
    <p v-else class="reel-empty">
      This bundle carries no matches to review.
    </p>
  </div>
</template>

<style scoped>
.coach-reel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.reel-head {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0 0 0.6rem;
  border-bottom: 1px solid var(--hairline);
}

.reel-title { margin: 0; }

.reel-clock {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--type-3xs);
  letter-spacing: 0.1em;

  /* --text-mute is 3.98:1 on Day's frame surface — this is the player's
     clock, content rather than decoration, so it takes --text-dim. */
  color: var(--text-dim);
  text-transform: uppercase;
}

/* The strip scrolls on its own so the desk and the sheet stay put
   while the coach walks the reel. */
.reel-strip {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0.7rem 0.2rem 0 0;
  overflow-y: auto;
  list-style: none;
}

.reel-empty {
  margin: 0.9rem 0 0;
  font-size: var(--type-md);
  color: var(--text-faint);
}
</style>
