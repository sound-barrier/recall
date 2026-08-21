<script setup lang="ts">
import NoteProse from '@/components/coach/notes/NoteProse.vue'
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

    <!--
      "Nothing to add" only when there is genuinely nothing. A moments-only
      review IS a reviewed_only note, so the bare kind check printed "nothing
      to add" directly above the observations it was showing — on the card the
      player reads to decide.
    -->
    <p v-if="reviewedOnly && !note.moments?.length" class="return-card-text is-mark">
      Reviewed — nothing to add.
    </p>
    <NoteProse v-else-if="note.text" class="return-card-text" :text="note.text" />

    <p v-if="note.match_clock" class="return-card-clock">
      {{ note.match_clock }}
    </p>

    <!--
      The moments are shown BEFORE the verdict, not after accepting: a player
      deciding whether to take a note should see everything it carries. Most
      of a timestamped review IS the moments, so a card that hid them would be
      asking for a decision about content the reader cannot see.
    -->
    <ol v-if="note.moments?.length" class="return-card-moments">
      <li v-for="moment in note.moments" :key="moment.moment_id" class="return-card-moment">
        <span class="return-card-moment-clock">{{ moment.match_clock }}</span>
        <span class="return-card-moment-body">
          <span v-if="moment.focus_tag" class="paper-chip return-card-moment-tag">
            {{ focusTagLabel(moment.focus_tag) }}
          </span>
          {{ moment.text }}
        </span>
      </li>
    </ol>

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

<style scoped src="./coach-return-card.css"></style>
