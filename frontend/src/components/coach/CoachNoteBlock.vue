<script setup lang="ts">
import { computed } from 'vue'

import type { MatchCoachNote } from '@/api-client'
import { useWriteGate } from '@/composables/shared/useWriteGate'
import { focusTagLabel } from '@/match/coach-notes'
import { useCoachStore } from '@/stores/coach'

// One accepted coach note, on the match it is about — the coach-RECEIVED
// layer. It sits BESIDE the player's own journal entry and never merges
// into it: a coach speaks in their own block, signed and dated, and the
// player can drop it again.
//
// Blocks accumulate — one per coach and session — so a second archive from
// the same coach adds a block rather than overwriting the first.
const props = defineProps<{
  matchKey: string
  note: MatchCoachNote
}>()

const coach = useCoachStore()

// Dropping a block is a write on the player's own database, so it obeys the
// same gate as the journal it sits in. The button disables with the reason,
// and the guard is what refuses a click that arrives anyway.
const { writesLocked, lockReason, guardWrite } = useWriteGate()

const tags = computed(() => [...(props.note.focus_tags ?? []), ...(props.note.extra_tags ?? [])])

function remove() {
  if (!guardWrite()) return
  void coach.removeCoachNote(props.matchKey, props.note.id)
}
</script>

<template>
  <section
    class="paper coach-note-block"
    role="region"
    :aria-label="`Coach's note from ${note.coach_name}`"
  >
    <header class="cnb-head">
      <span class="eyebrow ink">Coach's note from {{ note.coach_name }}</span>
      <span class="paper-chip cnb-reviewed">Reviewed by coach</span>
    </header>

    <p v-if="note.text" class="cnb-text">
      {{ note.text }}
    </p>
    <p v-else class="cnb-text is-mark">
      Reviewed — nothing to add.
    </p>

    <p v-if="note.match_clock" class="cnb-clock">
      {{ note.match_clock }}
    </p>

    <ul v-if="tags.length" class="cnb-tags">
      <li v-for="tag in tags" :key="tag" class="paper-chip">
        {{ focusTagLabel(tag) }}
      </li>
    </ul>

    <footer class="cnb-foot">
      <span class="cnb-sign">— {{ note.coach_name }} · {{ note.session_date }}</span>
      <button
        type="button"
        class="paper-btn cnb-remove"
        :disabled="writesLocked"
        :title="lockReason || undefined"
        @click="remove"
      >
        Remove this note
      </button>
    </footer>
  </section>
</template>

<style scoped>
.coach-note-block {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-top: 0.6rem;
  padding: 0.7rem 0.8rem 0.75rem;
}

.cnb-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.cnb-reviewed { cursor: default; }

.cnb-text {
  margin: 0;
  font-size: var(--type-lg);
  line-height: 1.5;
  color: var(--ink);
}

.cnb-text.is-mark {
  font-style: italic;
  color: var(--ink-dim);
}

.cnb-clock {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--type-xs);
  font-feature-settings: "tnum";
  color: var(--ink-dim);
}

.cnb-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.cnb-tags .paper-chip { cursor: default; }

.cnb-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding-top: 0.4rem;
  border-top: 1px solid var(--paper-rule);
}

.cnb-sign {
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.04em;
  color: var(--ink-faint);
}

.cnb-remove {
  padding: 0.28rem 0.6rem;
  font-size: var(--type-2xs);
}
</style>
