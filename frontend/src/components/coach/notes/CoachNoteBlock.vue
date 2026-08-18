<script setup lang="ts">
import { computed } from 'vue'

import type { MatchCoachNote } from '@/api-client'
import { useWriteGate } from '@/composables/shared/useWriteGate'
import { focusTagLabel } from '@/match/coach/coach-notes'
import { useCoachReturnsStore } from '@/stores/coachReturns'

// One accepted coach note, on the match it is about — the coach-RECEIVED
// layer. It sits BESIDE the player's own journal entry and never merges
// into it: a coach speaks in their own block, signed and dated, and the
// player can drop it again.
//
// Blocks accumulate — one per coach and session — so a second archive from
// the same coach adds a block rather than overwriting the first.
const props = withDefaults(defineProps<{
  matchKey: string
  note: MatchCoachNote
  /** The player's replay code for this match — '' when they never entered one. */
  replayCode?: string
}>(), { replayCode: '' })

const emit = defineEmits<{ 'copy-replay': [] }>()

const returns = useCoachReturnsStore()

// Dropping a block is a write on the player's own database, so it obeys the
// same gate as the journal it sits in. The button disables with the reason,
// and the guard is what refuses a click that arrives anyway.
const { writesLocked, lockReason, guardWrite } = useWriteGate()

const tags = computed(() => [...(props.note.focus_tags ?? []), ...(props.note.extra_tags ?? [])])

function remove() {
  if (!guardWrite()) return
  void returns.removeCoachNote(props.matchKey, props.note.id)
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
    <p v-else-if="!note.moments?.length" class="cnb-text is-mark">
      Reviewed — nothing to add.
    </p>

    <p v-if="note.match_clock" class="cnb-clock">
      {{ note.match_clock }}
    </p>

    <!--
      The coach's timestamped moments, in the order they wrote them — down the
      match. Read-only here: this is the player's copy of someone else's
      review, and the replay code beside each one is what makes a timestamp
      something they can act on rather than trivia.
    -->
    <ol v-if="note.moments?.length" class="cnb-moments">
      <li v-for="moment in note.moments" :key="moment.moment_id" class="cnb-moment">
        <span class="cnb-moment-clock">{{ moment.match_clock }}</span>
        <span class="cnb-moment-body">
          <span v-if="moment.focus_tag" class="paper-chip cnb-moment-tag">
            {{ focusTagLabel(moment.focus_tag) }}
          </span>
          {{ moment.text }}
        </span>
      </li>
    </ol>
    <p v-if="note.moments?.length && replayCode" class="cnb-replay">
      <span class="cnb-replay-code">replay {{ replayCode }}</span>
      <button
        type="button"
        class="paper-chip"
        aria-label="Copy replay code to watch these moments"
        @click="emit('copy-replay')"
      >
        Copy
      </button>
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

/* The moments read down the match. The clock is the column the eye follows,
   so it is fixed-width and tabular and the text hangs off it — the same
   arrangement the ledger uses, because it is the same list. */
.cnb-moments {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin: 0.2rem 0 0;
  padding: 0;
  list-style: none;
}

.cnb-moment {
  display: grid;
  grid-template-columns: 3.4rem 1fr;
  gap: 0.5rem;
  align-items: baseline;
}

.cnb-moment + .cnb-moment {
  padding-top: 0.35rem;
  border-top: 1px solid var(--hairline);
}

.cnb-moment-clock {
  font-family: var(--mono);
  font-size: var(--type-xs);
  font-feature-settings: "tnum";
  font-weight: 700;
  color: var(--text);
}

.cnb-moment-body {
  font-size: var(--type-sm);
  line-height: 1.45;
  color: var(--text);
}

.cnb-moment-tag {
  margin-right: 0.35rem;
  font-size: var(--type-4xs);
}

.cnb-replay {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  margin: 0.25rem 0 0;
}

.cnb-replay-code {
  font-family: var(--mono);
  font-size: var(--type-3xs);
  color: var(--text-dim);
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
