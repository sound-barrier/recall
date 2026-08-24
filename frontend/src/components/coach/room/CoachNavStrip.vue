<script setup lang="ts">
import { computed } from 'vue'

import { playerClockOwner } from '@/match/match-time-helpers'
import type { ViewId } from '@/composables/shared/keyboard/useTabKeyboardNav'
import { useAppStore } from '@/stores/app'
import { useCoachStore } from '@/stores/coach'
import { useSelfReviewStore } from '@/stores/selfReview'
import { useUiStore } from '@/stores/ui'

// The bridge between the film room (the Reviews tab, while a session is
// open) and the other tabs running on the player's data. From the room it
// offers the way IN, by name, so "step into Sable's Matches" reads as one
// sentence; from anywhere else it is the way back — visible on every tab,
// because a coach who wandered into Settings should never have to hunt for
// the room.
//
// The player's own sitting gets the same bridge, one-directional: away from
// the Reviews tab the strip is "← Back to your review" (the room's own back
// button already covers the other direction), and a coach session outranks
// it — the sitting's writes are gated then anyway.

/** Trends is a section of the Matches view, not a tab — hence the sentinel. */
type StepTarget = ViewId | 'trends'

interface StepInto {
  label: string
  target: StepTarget
}

const STEPS: readonly StepInto[] = [
  { label: 'Matches', target: 'matches' },
  { label: 'Trends', target: 'trends' },
  { label: 'Compare', target: 'compare' },
  { label: 'Elo', target: 'elo' },
]

const appStore = useAppStore()
const coach = useCoachStore()
const selfReview = useSelfReviewStore()
const ui = useUiStore()

const sittingAway = computed(() =>
  !coach.sessionActive && selfReview.roomOpen && appStore.view !== 'reviews')

// The room is the Reviews tab's content while a session is open, so "in the
// room" and "on the Reviews tab" are the same fact.
const inRoom = computed(() => appStore.view === 'reviews')
// One shared fallback for every possessive — never a dangling "Step into 's:".
const owner = computed(() => playerClockOwner(coach.player?.handle ?? ''))
// A codes session carries no history: the doors would open onto charts over
// blank replay stubs, which reads as the app being broken.
const hasHistory = computed(() => coach.sessionSource !== 'replay')

function stepInto(target: StepTarget): void {
  if (target === 'trends') {
    ui.requestTrendsOpen()
    void appStore.goToView('matches')
    return
  }
  void appStore.goToView(target)
}
</script>

<template>
  <nav v-if="sittingAway" class="coach-nav" aria-label="Your open review">
    <button
      type="button"
      class="btn ghost coach-nav-btn"
      @click="appStore.goToView('reviews')"
    >
      ← Back to your review
    </button>
  </nav>
  <nav v-else class="coach-nav" aria-label="Coaching session">
    <template v-if="inRoom && hasHistory">
      <span class="eyebrow accent coach-nav-lead">Step into {{ owner }}'s:</span>
      <button
        v-for="step in STEPS"
        :key="step.target"
        type="button"
        class="btn ghost coach-nav-btn"
        @click="stepInto(step.target)"
      >
        {{ step.label }}
      </button>
    </template>
    <span v-else-if="inRoom" class="eyebrow coach-nav-lead">
      No history came with these codes — what you see is what was typed.
    </span>
    <button
      v-else
      type="button"
      class="btn ghost coach-nav-btn"
      @click="appStore.goToView('reviews')"
    >
      ← Back to the film room
    </button>
  </nav>
</template>

<style scoped>
.coach-nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
}

.coach-nav-lead {
  margin-right: var(--space-1);
}

.coach-nav-btn {
  padding: 0.25rem 0.6rem;
  font-size: var(--type-2xs);
}
</style>
