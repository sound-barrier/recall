<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { FOCUS_TAGS, focusTagLabel, parseMatchClock } from '@/match/coach/coach-notes'
import { isPastTheEnd } from '@/match/coach/coach-cue-geometry'
import { isSavable, type CoachMoment } from '@/match/coach/coach-moments'

// One cue on the strip: when it happened, what happened, and the replay code
// that lets the reader get there.
//
// The clock keeps LOCAL raw state so a half-typed "9:9" stays on screen — the
// same treatment the note's own clock field gets. An unreadable clock never
// reaches the draft, so the strip cannot store a moment pointing at nothing.
const props = defineProps<{
  moment: CoachMoment
  /** MM:SS from the match, or '' when no capture reported one. */
  gameLength: string
  /** The player's replay code for this match, or '' when they never entered one. */
  replayCode: string
  blocked?: boolean
  blockedReason?: string
}>()

const emit = defineEmits<{
  update: [moment: CoachMoment]
  remove: []
  'copy-replay': []
}>()

const clockRaw = ref(props.moment.matchClock)
watch(() => props.moment.matchClock, (incoming) => {
  // Only when the store's value genuinely differs from what this field is
  // showing — otherwise every keystroke's own echo would reformat mid-type.
  if (parseMatchClock(clockRaw.value) !== incoming) clockRaw.value = incoming
})

const clockValid = computed(() => clockRaw.value === '' || parseMatchClock(clockRaw.value) !== null)

// The row is named by its time once it is a moment, and stays "New moment"
// until then. Keyed on isSavable rather than on the clock alone so the name
// does not change the instant a clock is typed — renaming a group under a
// screen-reader user who is still filling it in is disorienting, and it also
// makes the row impossible to address while it is being written.
const rowLabel = computed(() =>
  isSavable(props.moment) ? `Moment at ${props.moment.matchClock}` : 'New moment')

const pastTheEnd = computed(() => isPastTheEnd(props.moment.matchClock, props.gameLength))

function onClockInput(value: string) {
  clockRaw.value = value
  const parsed = parseMatchClock(value)
  if (parsed !== null) emit('update', { ...props.moment, matchClock: parsed })
}

function onTextInput(value: string) {
  emit('update', { ...props.moment, text: value })
}

function onTagChange(tag: string) {
  emit('update', { ...props.moment, focusTag: props.moment.focusTag === tag ? '' : tag })
}
</script>

<template>
  <li class="cue-row">
    <div class="cue-rail" aria-hidden="true">
      <span class="cue-punch" />
    </div>
    <div class="cue-body" role="group" :aria-label="rowLabel">
      <div class="cue-head">
        <span v-if="moment.matchClock" class="cue-clock" data-testid="moment-clock">
          {{ moment.matchClock }}
        </span>
        <label class="sr-only" :for="`cue-clock-${moment.momentId}`">Clock</label>
        <input
          :id="`cue-clock-${moment.momentId}`"
          class="cue-clock-input"
          type="text"
          inputmode="numeric"
          placeholder="MM:SS"
          :value="clockRaw"
          :disabled="blocked"
          :title="blocked ? blockedReason : undefined"
          :aria-invalid="clockValid ? undefined : 'true'"
          @input="onClockInput(($event.target as HTMLInputElement).value)"
        >
        <button
          type="button"
          class="paper-chip cue-remove"
          :disabled="blocked"
          :aria-label="`Remove this moment${moment.matchClock ? ` at ${moment.matchClock}` : ''}`"
          @click="emit('remove')"
        >
          ×
        </button>
      </div>

      <label class="sr-only" :for="`cue-text-${moment.momentId}`">What happened</label>
      <textarea
        :id="`cue-text-${moment.momentId}`"
        class="cue-text"
        rows="2"
        :value="moment.text"
        :disabled="blocked"
        :title="blocked ? blockedReason : undefined"
        placeholder="What happened at this moment?"
        @input="onTextInput(($event.target as HTMLTextAreaElement).value)"
      />

      <div class="cue-foot">
        <div class="cue-tags" role="group" :aria-label="`Focus for ${rowLabel.toLowerCase()}`">
          <button
            v-for="tag in FOCUS_TAGS"
            :key="tag"
            type="button"
            class="paper-chip cue-tag"
            :aria-pressed="moment.focusTag === tag"
            :disabled="blocked"
            @click="onTagChange(tag)"
          >
            {{ focusTagLabel(tag) }}
          </button>
        </div>
        <!--
          The replay code is what makes a timestamp actionable: Recall cannot
          drive the game, so the furthest a link can go is handing over the
          code to paste into the replay viewer. Absent when the player never
          entered one — an empty affordance would be a promise the data
          cannot keep.
        -->
        <p v-if="replayCode" class="cue-replay">
          <span class="cue-replay-code">replay {{ replayCode }}</span>
          <button
            type="button"
            class="paper-chip"
            :aria-label="`Copy replay code for the moment at ${moment.matchClock || 'this match'}`"
            @click="emit('copy-replay')"
          >
            Copy
          </button>
        </p>
      </div>

      <p v-if="pastTheEnd" class="cue-warn" role="status">
        {{ moment.matchClock }} is longer than this match ({{ gameLength }}). Saved anyway —
        check the time.
      </p>
    </div>
  </li>
</template>

<style scoped src="./coach-cue.css"></style>
