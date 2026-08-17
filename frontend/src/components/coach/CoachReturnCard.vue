<script setup lang="ts">
import { computed } from 'vue'

import type { CoachDecisionEnum, CoachReturnItem } from '@/api-client'
import { isOrphan } from '@/composables/coach/useCoachReturnDecisions'
import { focusTagLabel } from '@/match/coach/coach-notes'

// One returned note on the player's decision sheet: what the coach wrote,
// which match it is about, and the Accept / Skip verdict. Presentational —
// the sheet owns the verdict map and the round-trip.
//
// A note whose match is no longer in this history is an ORPHAN: it is shown
// (the coach still said something) but can only be skipped, because
// accepting it would have nowhere to write.
const props = defineProps<{
  note: CoachReturnItem
  /** '' while undecided. */
  verdict: CoachDecisionEnum | ''
}>()

const emit = defineEmits<{
  decide: [decision: CoachDecisionEnum]
}>()

const orphan = computed(() => isOrphan(props.note))
// The server derives this from a block already sitting on the match — a
// fact the client cannot see for itself. Without it a repeat session shows
// notes the player already took as indistinguishable from the new ones.
const alreadyAccepted = computed(() => props.note.status === 'accepted')
const reviewedOnly = computed(() => props.note.kind === 'reviewed_only')
const tags = computed(() => [...props.note.focus_tags, ...props.note.extra_tags])

// "numbani · ana · victory" — the descriptive snapshot the archive carries,
// so a note still reads even when its match is gone.
const matchLabel = computed(() => {
  const m = props.note.match
  if (!m) return props.note.match_key
  return [m.map, m.hero, m.result].filter(Boolean).join(' · ')
})

const playedLabel = computed(() => {
  const m = props.note.match
  if (!m) return ''
  return [m.date, m.finished_at].filter(Boolean).join(' · ')
})

function pick(decision: CoachDecisionEnum) {
  if (decision === 'accepted' && orphan.value) return
  emit('decide', decision)
}
</script>

<template>
  <article
    class="paper return-card"
    :class="{ 'is-orphan': orphan, 'is-taken': alreadyAccepted }"
    :aria-label="alreadyAccepted
      ? `Note about ${matchLabel} — already accepted`
      : `Note about ${matchLabel}`"
  >
    <header class="return-card-head">
      <h3 class="return-card-match">
        {{ matchLabel }}
      </h3>
      <span v-if="playedLabel" class="return-card-when">{{ playedLabel }}</span>
    </header>

    <p v-if="alreadyAccepted" class="return-card-taken">
      You already accepted this one — it is on the match now.
    </p>

    <p v-if="reviewedOnly" class="return-card-text is-mark">
      Reviewed — nothing to add.
    </p>
    <p v-else class="return-card-text">
      {{ note.text }}
    </p>

    <p v-if="note.match_clock" class="return-card-clock">
      {{ note.match_clock }}
    </p>

    <ul v-if="tags.length" class="return-card-tags">
      <li v-for="tag in tags" :key="tag" class="paper-chip">
        {{ focusTagLabel(tag) }}
      </li>
    </ul>

    <p v-if="orphan" class="return-card-orphan">
      This match isn't in your history any more, so there is nothing to accept it onto.
      You can skip it.
    </p>

    <div
      class="return-card-verdict"
      role="radiogroup"
      :aria-label="`Verdict on the note about ${matchLabel}`"
    >
      <button
        type="button"
        class="paper-chip"
        role="radio"
        :aria-checked="verdict === 'accepted'"
        :tabindex="verdict === 'accepted' ? 0 : -1"
        :disabled="orphan"
        :title="orphan ? 'This note has no match to land on.' : 'Save this note onto the match'"
        @click="pick('accepted')"
      >
        Accept
      </button>
      <button
        type="button"
        class="paper-chip"
        role="radio"
        :aria-checked="verdict === 'skipped'"
        :tabindex="verdict === 'skipped' || (orphan && verdict !== 'accepted') ? 0 : -1"
        title="Leave this note out of your history"
        @click="pick('skipped')"
      >
        Skip
      </button>
    </div>
  </article>
</template>

<style scoped>
.return-card {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.75rem 0.85rem 0.8rem;
}

.return-card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.6rem;
}

.return-card-match {
  margin: 0;
  font-family: var(--display);
  font-size: var(--type-xl);
  letter-spacing: 0.02em;
  text-transform: capitalize;
  color: var(--ink);
}

.return-card-when {
  font-family: var(--mono);
  font-size: var(--type-2xs);
  font-feature-settings: "tnum";
  color: var(--ink-faint);
}

.return-card-text {
  margin: 0;
  font-size: var(--type-lg);
  line-height: 1.5;
  color: var(--ink);
}

.return-card-text.is-mark {
  font-style: italic;
  color: var(--ink-dim);
}

.return-card-clock {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--type-xs);
  font-feature-settings: "tnum";
  color: var(--ink-dim);
}

.return-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* The tag chips are labels here, not controls. */
.return-card-tags .paper-chip { cursor: default; }

.return-card-orphan {
  margin: 0;
  font-size: var(--type-sm);
  line-height: 1.45;
  color: var(--ink-dim);
}

.return-card-verdict {
  display: flex;
  gap: 0.35rem;
  padding-top: 0.35rem;
  border-top: 1px solid var(--paper-rule);
}

.return-card-verdict .paper-chip:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.return-card.is-orphan {
  border-style: dashed;
}

.return-card-taken {
  margin: 0;
  font-size: var(--type-sm);
  line-height: 1.45;
  color: var(--ink-dim);
}

/* A taken note recedes rather than disappears — the player may still want
   to skip it, which removes the block. The state is carried by the
   sentence above and the accessible name, never by this tint alone. */
.return-card.is-taken {
  background: var(--paper-2);
}
</style>
