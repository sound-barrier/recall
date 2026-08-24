<script setup lang="ts">
import NoteProse from '@/components/coach/notes/NoteProse.vue'
import { computed } from 'vue'

import type { CoachDecisionEnum, CoachReturnItem } from '@/api-client'
import { isOrphan } from '@/composables/coach/useCoachReturnDecisions'
import { focusTagLabel } from '@/match/coach/coach-notes'
import { formatPlayerDay } from '@/match/coach/coach-time'

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
// so a note still reads even when its match is gone. An orphan with no
// snapshot gets human copy, never the raw internal key — that goes in the
// small mono slot for anyone correlating by hand.
const matchLabel = computed(() => {
  const m = props.note.match
  if (!m) return 'A match no longer in your history'
  return [m.map, m.hero, m.result].filter(Boolean).join(' · ')
})

// The app's date language, not raw wire values: "Fri · Aug 21 · 22:30".
const playedLabel = computed(() => {
  const m = props.note.match
  if (!m) return props.note.match_key
  return [m.date ? formatPlayerDay(m.date) : '', m.finished_at].filter(Boolean).join(' · ')
})

// Skip is only "leave it out" while the note is not on the match yet. On an
// already-accepted note the same verdict UN-writes it, so the control says
// that instead of promising a no-op.
const skipLabel = computed(() => (alreadyAccepted.value ? 'Remove from the match' : 'Skip'))
const skipTitle = computed(() => (alreadyAccepted.value
  ? 'Take this note back off the match'
  : 'Leave this note out of your history'))

function pick(decision: CoachDecisionEnum) {
  if (decision === 'accepted' && orphan.value) return
  emit('decide', decision)
}

// Real roving for the radiogroup: while undecided nothing is checked, so the
// checked-chip-is-tabbable rule left BOTH radios at tabindex -1 and the pair
// was unreachable without a mouse. One radio is always the Tab stop — the
// checked one, else the first the note allows — and arrows move AND select,
// the way a radio group moves.
const acceptTab = computed(() => {
  if (props.verdict === 'accepted') return 0
  if (props.verdict === '' && !orphan.value) return 0
  return -1
})
const skipTab = computed(() => {
  if (props.verdict === 'skipped') return 0
  if (props.verdict === '' && orphan.value) return 0
  return -1
})

function onArrow(e: KeyboardEvent) {
  const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown'
  const backward = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
  if (!forward && !backward) return
  e.preventDefault()
  const onAccept = (e.target as HTMLElement).matches('[data-verdict="accepted"]')
  const next: CoachDecisionEnum = onAccept ? 'skipped' : 'accepted'
  if (next === 'accepted' && orphan.value) return
  emit('decide', next)
  const sel = next === 'accepted' ? '[data-verdict="accepted"]' : '[data-verdict="skipped"]'
  ;(e.currentTarget as HTMLElement).querySelector<HTMLButtonElement>(sel)?.focus()
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
      at {{ note.match_clock }} in the match
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
      :class="{ 'is-decided': verdict !== '' }"
      role="radiogroup"
      :aria-label="`Verdict on the note about ${matchLabel}`"
      @keydown="onArrow"
    >
      <button
        type="button"
        class="paper-chip verdict-chip"
        role="radio"
        data-verdict="accepted"
        :aria-checked="verdict === 'accepted'"
        :tabindex="acceptTab"
        :disabled="orphan"
        :title="orphan ? 'This note has no match to land on.' : 'Save this note onto the match'"
        @click="pick('accepted')"
      >
        Accept
      </button>
      <button
        type="button"
        class="paper-chip verdict-chip"
        role="radio"
        data-verdict="skipped"
        :aria-checked="verdict === 'skipped'"
        :tabindex="skipTab"
        :title="skipTitle"
        @click="pick('skipped')"
      >
        {{ skipLabel }}
      </button>
    </div>
  </article>
</template>

<style scoped src="./coach-return-card.css"></style>
