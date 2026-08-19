<script setup lang="ts">
import { computed } from 'vue'

import { useWriteGate } from '@/composables/shared/useWriteGate'
import { focusTagLabel } from '@/match/coach/coach-notes'
import type { NoteBlockView } from '@/match/coach/note-block-view'
import { useCoachReturnsStore } from '@/stores/coachReturns'
import { useSelfReviewStore } from '@/stores/selfReview'

// One note block on the match it is about: an accepted coach's note (the
// coach-RECEIVED layer) or the player's own from one of their review
// sittings. Either sits BESIDE the player's journal entry and never merges
// into it — a coach speaks in their own block, signed and dated, and a
// sitting is its own voice too. Blocks accumulate, one per coach and
// session / one per sitting, and the player can drop any of them.
//
// What the block SAYS comes in as a view (note-block-view.ts) — the two
// families differ only in attribution and in what removing one means, and
// the builders there are where each word comes from.
const props = withDefaults(defineProps<{
  matchKey: string
  block: NoteBlockView
  /** The player's replay code for this match — '' when they never entered one. */
  replayCode?: string
}>(), { replayCode: '' })

const emit = defineEmits<{ 'copy-replay': [] }>()

const returns = useCoachReturnsStore()
const selfReview = useSelfReviewStore()

// Dropping a block is a write on the player's own database, so it obeys the
// same gate as the journal it sits in. The button disables with the reason,
// and the guard is what refuses a click that arrives anyway.
const { writesLocked, lockReason, guardWrite } = useWriteGate()

const tags = computed(() => props.block.tags)
const moments = computed(() => props.block.moments)

function remove() {
  if (!guardWrite()) return
  const removal = props.block.removal
  if (removal.kind === 'coach') {
    void returns.removeCoachNote(props.matchKey, removal.id)
  } else {
    void selfReview.removeNoteFromSitting(removal.reviewId, props.matchKey)
  }
}
</script>

<template>
  <section
    class="paper coach-note-block"
    role="region"
    :aria-label="block.heading"
  >
    <header class="cnb-head">
      <span class="eyebrow ink">{{ block.heading }}</span>
      <span class="paper-chip cnb-reviewed">{{ block.status }}</span>
    </header>

    <p v-if="block.text" class="cnb-text">
      {{ block.text }}
    </p>
    <p v-else-if="!moments.length" class="cnb-text is-mark">
      Reviewed — nothing to add.
    </p>

    <p v-if="block.matchClock" class="cnb-clock">
      {{ block.matchClock }}
    </p>

    <!--
      The coach's timestamped moments, in the order they wrote them — down the
      match. Read-only here: this is the player's copy of someone else's
      review, and the replay code beside each one is what makes a timestamp
      something they can act on rather than trivia.
    -->
    <ol v-if="moments.length" class="cnb-moments">
      <li v-for="moment in moments" :key="moment.moment_id" class="cnb-moment">
        <span class="cnb-moment-clock">{{ moment.match_clock }}</span>
        <span class="cnb-moment-body">
          <span v-if="moment.focus_tag" class="paper-chip cnb-moment-tag">
            {{ focusTagLabel(moment.focus_tag) }}
          </span>
          {{ moment.text }}
        </span>
      </li>
    </ol>
    <p v-if="moments.length && replayCode" class="cnb-replay">
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
      <span class="cnb-sign">{{ block.sign }}</span>
      <button
        type="button"
        class="paper-btn cnb-remove"
        :disabled="writesLocked"
        :title="lockReason || undefined"
        @click="remove"
      >
        {{ block.removeLabel }}
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
