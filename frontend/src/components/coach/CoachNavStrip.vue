<script setup lang="ts">
import { computed } from 'vue'

import type { ViewId } from '@/composables/shared/keyboard/useTabKeyboardNav'
import { useAppStore } from '@/stores/app'
import { useCoachStore } from '@/stores/coach'
import { useUiStore } from '@/stores/ui'

// The bridge between the film room and the six tabs running on the
// player's data. From the room it offers the way IN, by name, so "step
// into Sable's Matches" reads as one sentence; from anywhere else it is
// the way back — visible on every tab, because a coach who wandered into
// Settings should never have to hunt for the room.

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
const ui = useUiStore()

const inRoom = computed(() => appStore.view === 'coach')
const handle = computed(() => coach.player?.handle ?? '')

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
  <nav class="coach-nav" aria-label="Coaching session">
    <template v-if="inRoom">
      <span class="eyebrow accent coach-nav-lead">Step into {{ handle }}'s:</span>
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
    <button
      v-else
      type="button"
      class="btn ghost coach-nav-btn"
      @click="appStore.goToView('coach')"
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
