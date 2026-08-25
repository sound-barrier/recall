<script setup lang="ts">
import { computed } from 'vue'

import type { MatchRecord } from '@/api-client'
import CoachReelDay from '@/components/coach/reel/CoachReelDay.vue'
import { DEFAULT_COACH_LABELS, type CoachLabels, type RoomVoice } from '@/components/coach/room/coach-room-props'
import type { CoachNoteDraft } from '@/match/coach/coach-notes'
import type { ReelDay } from '@/match/coach/coach-reel-helpers'
import { playerClockNote, playerClockOwner } from '@/match/match-time-helpers'

// The film strip: the player's matches, their days newest first, each
// frame a click target. The list is named for them AND for whose clock
// the times are in — the room shows player-naive times everywhere, and
// an unlabeled 21:14 is a lie to a coach in another timezone.

const props = withDefaults(defineProps<{
  handle: string
  days: ReelDay<MatchRecord>[]
  selectedKey: string
  notes: Record<string, CoachNoteDraft>
  labels?: CoachLabels
  /**
   * Whose matches these are. A coach's reel is someone else's — titled
   * "The reel", with the clock note (rule 7: an unlabeled 21:14 is a lie to a
   * coach in another timezone). The player's own sitting is "Your matches",
   * and there is no note to give about your own clock.
   */
  voice?: RoomVoice
  /** 'team' names a codes corpus — the frames are replays, not matches. */
  subjectKind?: 'player' | 'team'
}>(), { labels: () => DEFAULT_COACH_LABELS, voice: 'their', subjectKind: 'player' })

const emit = defineEmits<{ select: [matchKey: string] }>()

const yours = computed(() => props.voice === 'your')
const reelTitle = computed(() => (yours.value ? 'Your matches' : 'The reel'))
const reelLabel = computed(() => {
  if (yours.value) return 'Your matches'
  const owner = playerClockOwner(props.handle)
  const corpus = props.subjectKind === 'team' ? 'replays' : 'matches'
  return `${owner}'s ${corpus} — times in ${owner}'s clock`
})
const emptyLine = computed(() => (yours.value
  ? 'None of the matches in this review are in your history any more.'
  : 'This bundle carries no matches to review.'))
</script>

<template>
  <div class="coach-reel">
    <header class="reel-head">
      <h2 class="eyebrow accent reel-title">
        {{ reelTitle }}
      </h2>
      <p v-if="!yours" class="reel-clock">
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
      {{ emptyLine }}
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
