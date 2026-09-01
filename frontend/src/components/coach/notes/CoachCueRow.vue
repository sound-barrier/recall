<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { FOCUS_TAGS, focusTagLabel, parseMatchClock } from '@/match/coach/coach-notes'
import { EMPTY_CLOCK } from '@/match/coach/match-clock-field'
import { useMatchClockField } from '@/composables/coach/useMatchClockField'
import type { CoachSaveState } from '@/components/coach/room/coach-room-props'
import { isPastTheEnd } from '@/match/coach/coach-cue-geometry'
import { isSavable, momentImageURL, type CoachMoment } from '@/match/coach/coach-moments'
import { pickFile } from '@/api-platform'

// One cue on the strip: when it happened, what happened, and the replay code
// that lets the reader get there.
//
// The clock keeps LOCAL raw state so a half-typed "9:9" stays on screen — the
// same treatment the note's own clock field gets. An unreadable clock never
// reaches the draft, so the strip cannot store a moment pointing at nothing.
const props = withDefaults(defineProps<{
  moment: CoachMoment
  /** MM:SS from the match, or '' when no capture reported one. */
  gameLength: string
  /** The player's replay code for this match, or '' when they never entered one. */
  replayCode: string
  blocked?: boolean
  blockedReason?: string
  /** Where this moment's own autosave stands. */
  saveState?: CoachSaveState
  /** Position on the strip, so two moments at one second are still distinct. */
  index: number
  total: number
}>(), { saveState: 'idle' as CoachSaveState, blocked: false, blockedReason: '' })

const emit = defineEmits<{
  update: [moment: CoachMoment]
  remove: []
  'copy-replay': []
  /**
   * A file the reader dropped or picked. The row hands it UP rather than
   * uploading: it is a presentational leaf, and both hosts already own the
   * moment's persistence — putting the request here would put it in two
   * places that then have to agree about failure.
   */
  attach: [file: File]
}>()

// What the store will take and the handler will serve back. Stated here so a
// wrong file is refused where the reader dropped it, rather than after a round
// trip that ends in a 400 about a word they never typed.
const ATTACHABLE = ['image/png', 'image/jpeg']

const dragOver = ref(false)
const attachError = ref('')

function offerFile(file: File | null): void {
  attachError.value = ''
  if (!file) return
  if (!ATTACHABLE.includes(file.type)) {
    attachError.value = 'That is not a PNG or JPEG.'
    return
  }
  emit('attach', file)
}

function onDrop(e: DragEvent): void {
  dragOver.value = false
  // Only a FILE drop is an attachment. The reorder drags elsewhere in the app
  // move an id as text/plain, and dragging a link or a selection across a cue
  // row must not read as pinning a frame to it.
  const file = e.dataTransfer?.files?.[0] ?? null
  offerFile(file)
}

async function onPickFile(): Promise<void> {
  offerFile(await pickFile(ATTACHABLE.join(',')))
}

function detach(): void {
  emit('update', { ...props.moment, imageSHA256: '' })
}

// Always a complete MM:SS — a moment with no clock yet starts at 00:00
// rather than empty, which is what lets the digits shift in with no
// punctuation to type.
const clockRaw = ref(props.moment.matchClock || EMPTY_CLOCK)
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
//
// The POSITION is part of the name, because two moments can share a second
// and a coach with two unfinished rows open has two "New moment"s. A name
// several elements answer to is not a name.
const rowLabel = computed(() => {
  const nth = `${props.index + 1} of ${props.total}`
  return isSavable(props.moment)
    ? `Moment ${nth}, at ${props.moment.matchClock}`
    : `New moment ${nth}`
})

const pastTheEnd = computed(() => isPastTheEnd(props.moment.matchClock, props.gameLength))

const { onKeydown: onClockKeydown } = useMatchClockField(
  () => clockRaw.value,
  (next) => {
    clockRaw.value = next
    const parsed = parseMatchClock(next)
    if (parsed !== null) emit('update', { ...props.moment, matchClock: parsed })
  },
)

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
    <div
      class="cue-body"
      :class="{ 'cue-drop-over': dragOver }"
      role="group"
      :aria-label="rowLabel"
      @dragover.prevent="dragOver = true"
      @dragenter.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop.prevent="onDrop"
    >
      <div class="cue-head">
        <!--
          The clock is shown ONCE, by the field that holds it. There used to
          be a read-only copy immediately to its left, so a moment with a
          clock displayed the same time twice, side by side.
        -->
        <label class="sr-only" :for="`cue-clock-${moment.momentId}`">Clock</label>
        <input
          :id="`cue-clock-${moment.momentId}`"
          class="cue-clock-input"
          type="text"
          inputmode="numeric"
          spellcheck="false"
          autocomplete="off"
          autocorrect="off"
          :value="clockRaw"
          :disabled="blocked"
          :title="blocked ? blockedReason : undefined"
          :aria-invalid="clockValid ? undefined : 'true'"
          @keydown="onClockKeydown"
        >
        <button
          type="button"
          class="paper-chip cue-remove"
          :disabled="blocked"
          :aria-label="`Remove ${rowLabel.toLowerCase()}`"
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
        spellcheck="true"
        autocorrect="off"
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
            :aria-label="`Copy replay code for ${rowLabel.toLowerCase()}`"
            @click="emit('copy-replay')"
          >
            Copy
          </button>
        </p>
      </div>

      <!--
        The frame this moment is about. Shown at a size you can recognize the
        fight in and not at a size that pushes the next cue off the strip; the
        full picture is one click away in the lightbox every other screenshot
        in the app opens in.
      -->
      <div v-if="moment.imageSHA256" class="cue-frame">
        <img
          :src="momentImageURL(moment.imageSHA256)"
          class="cue-frame-img"
          :alt="`Frame attached to ${rowLabel.toLowerCase()}`"
        >
        <button
          type="button"
          class="paper-chip cue-frame-remove"
          :disabled="blocked"
          :title="blocked ? blockedReason : undefined"
          :aria-label="`Remove the frame from ${rowLabel.toLowerCase()}`"
          @click="detach"
        >
          Remove frame
        </button>
      </div>
      <button
        v-else
        type="button"
        class="paper-chip cue-attach"
        :disabled="blocked"
        :title="blocked ? blockedReason : 'Drop a screenshot here, or pick one'"
        :aria-label="`Attach a frame to ${rowLabel.toLowerCase()}`"
        @click="onPickFile"
      >
        Attach a frame
      </button>

      <p v-if="attachError" class="cue-warn" role="status">
        {{ attachError }}
      </p>

      <!--
        A rejected save has to be visible on the ROW. The desk's own indicator
        is keyed on the match, and moments queue under their own ids, so a
        moment the server refused otherwise looked exactly like a saved one.
      -->
      <p v-if="saveState === 'error'" class="cue-warn" role="status">
        Not saved — try again.
      </p>

      <p v-if="pastTheEnd" class="cue-warn" role="status">
        {{ moment.matchClock }} is longer than this match ({{ gameLength }}). Saved anyway —
        check the time.
      </p>
    </div>
  </li>
</template>

<style scoped src="./coach-cue-row.css"></style>
