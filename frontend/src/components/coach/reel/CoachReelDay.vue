<script setup lang="ts">
import type { MatchRecord } from '@/api-client'
import CoachReelFrame from '@/components/coach/reel/CoachReelFrame.vue'
import { DEFAULT_COACH_LABELS, type CoachLabels } from '@/components/coach/room/coach-room-props'
import type { CoachNoteDraft } from '@/match/coach/coach-notes'
import { reelDayHeader, type ReelDay } from '@/match/coach/coach-reel-helpers'

// One of the player's days on the film strip: a ruled-paper header
// ("Sat · Aug 8 · 4 played · 2–2") over that day's frames, newest
// first. A real nested list, so the grouping and the reading order
// reach the accessibility tree rather than living in the layout.

withDefaults(defineProps<{
  day: ReelDay<MatchRecord>
  selectedKey: string
  notes: Record<string, CoachNoteDraft>
  labels?: CoachLabels
}>(), { labels: () => DEFAULT_COACH_LABELS })

const emit = defineEmits<{ select: [matchKey: string] }>()
</script>

<template>
  <li class="reel-day">
    <h3 class="eyebrow ink reel-day-head paper-rule-hatch">
      {{ reelDayHeader(day) }}
    </h3>
    <ol class="reel-day-frames">
      <CoachReelFrame
        v-for="frame in day.frames"
        :key="frame.match_key"
        :record="frame"
        :selected="frame.match_key === selectedKey"
        :draft="notes[frame.match_key]"
        :labels="labels"
        @select="(matchKey: string) => emit('select', matchKey)"
      />
    </ol>
  </li>
</template>

<style scoped>
.reel-day { display: block; }

/* The day label is written on the strip's paper leader, so it takes
   ink (.eyebrow.ink) on the hatch rather than the theme's faint text. */
.reel-day-head {
  margin: 0 0 0.4rem;
  padding: 0.28rem 0.5rem;
  border-radius: var(--radius);
}

.reel-day-frames {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin: 0 0 0.85rem;
  padding: 0;
  list-style: none;
}
</style>
