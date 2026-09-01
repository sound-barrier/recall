<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'

import { SAVE_LABEL, type CoachSaveState } from '@/components/coach/room/coach-room-props'
import type { RoomVoice } from '@/components/coach/room/coach-room-props'
import NoteWriter from '@/components/shared/NoteWriter.vue'
import { useMatchClockField } from '@/composables/coach/useMatchClockField'
import {
  FOCUS_TAGS, focusTagLabel, noteMark, parseMatchClock, type CoachNoteDraft,
} from '@/match/coach/coach-notes'

// The coach's note for the frame on the desk, written on paper. The
// editor is CONTROLLED: it holds no draft of its own, it reports every
// change through `update` and re-renders from whatever the session
// hands back — which is what keeps one player's draft from surviving
// into the next player's room.
//
// The one piece of local state is the raw clock text, because an
// in-progress "9:9" is not a value: it stays on screen, marked
// invalid, and only a parsed clock reaches the draft.

const props = withDefaults(defineProps<{
  /** The frame being written about — changing it re-reads the clock field. */
  matchKey: string
  draft: CoachNoteDraft
  saveState?: CoachSaveState
  /**
   * Why nothing typed here could be saved — an unconfirmed player, say.
   * Non-empty makes the whole editor inert and replaces the autosave line,
   * because accepting a paragraph that every PUT will refuse loses it.
   */
  blockedReason?: string
  hasPrev?: boolean
  hasNext?: boolean
  /** Whose matches these are — the placeholder and the switch follow it. */
  voice?: RoomVoice
}>(), { saveState: 'idle', blockedReason: '', hasPrev: false, hasNext: false, voice: 'their' })

const emit = defineEmits<{
  update: [draft: CoachNoteDraft]
  prev: []
  next: []
}>()

const CLOCK_HINT_ID = 'coach-note-clock-hint'

const clockRaw = ref(props.draft.matchClock)
const addingTag = ref(false)
const newTag = ref('')
const newTagField = useTemplateRef<HTMLInputElement>('newTagField')

watch(() => props.matchKey, () => {
  addingTag.value = false
  newTag.value = ''
})

// Re-read the field whenever the draft's clock changes under it — a new
// frame, or a session that hydrated its notes after the room mounted.
// Text the coach is still typing survives: an in-progress "9:9" never
// changes the draft, and a raw "4:12" that parses to the stored value is
// left exactly as typed.
watch(() => [props.matchKey, props.draft.matchClock] as const, ([, incoming]) => {
  if (parseMatchClock(clockRaw.value) === incoming) return
  clockRaw.value = incoming
})

const clockInvalid = computed(() => clockRaw.value.trim() !== '' && parseMatchClock(clockRaw.value) === null)
const reviewed = computed(() => props.draft.kind === 'reviewed_only')
const written = computed(() => noteMark(props.draft) === 'written')
const reviewedBlockedReason = 'A written note already counts as reviewed — clear it first.'

const blocked = computed(() => props.blockedReason !== '')

// Formatting is off while the switch says there is nothing to add. Pressing
// Bold on an empty reviewed_only note used to write `****`, which reads as a
// written note — so the switch disabled itself with "clear it first" and the
// note could never go back.
const toolsDisabled = computed(() => blocked.value || reviewed.value)
const toolsDisabledReason = computed(() => {
  if (blocked.value) return props.blockedReason
  return reviewed.value ? `“${switchLabel.value}” is on — turn it off to write.` : undefined
})

// The words follow the voice: a coach writes for someone else to read next
// time; you write for yourself. And "Reviewed" is the coach's stamp — over
// your own matches the switch means "looked at, nothing to add".
const notePlaceholder = computed(() => (props.voice === 'your'
  ? 'What will you do differently next time?'
  : 'What should they watch for next time?'))

// A coach files notes ABOUT someone else's match, so a clock and a focus
// tag are how they point at the moment they mean. Over your own matches the
// Moments strip already owns both, per match — the note is prose.
const filesUnderTags = computed(() => props.voice !== 'your')
const switchLabel = computed(() => (props.voice === 'your' ? 'Nothing to add' : 'Reviewed — nothing to add'))
const statusLine = computed(() => (blocked.value ? props.blockedReason : SAVE_LABEL[props.saveState]))
const reviewedDisabledReason = computed(() => {
  if (blocked.value) return props.blockedReason
  return written.value ? reviewedBlockedReason : undefined
})

function emitDraft(patch: Partial<CoachNoteDraft>): void {
  const next = { ...props.draft, ...patch }
  // Your own notes carry neither — the Moments strip owns the clock and the
  // tag, per match. Stripping on every emit rather than only on render means
  // a note that picked either up before the split can still be cleared, and
  // a leftover clock can never ride along with a reviewed_only kind, which
  // the server refuses outright.
  if (props.voice === 'your') emit('update', { ...next, focusTags: [], matchClock: '' })
  else emit('update', next)
}

function toggleTag(list: 'focusTags' | 'extraTags', tag: string): void {
  const current = props.draft[list]
  const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]
  emitDraft({ kind: 'note', [list]: next })
}

function commitNewTag(): void {
  const tag = newTag.value.trim()
  if (tag !== '' && !props.draft.extraTags.includes(tag)) toggleTag('extraTags', tag)
  newTag.value = ''
  addingTag.value = false
}

function startAddingTag(): void {
  addingTag.value = true
  void nextTick(() => newTagField.value?.focus())
}

const { onKeydown: onClockKeydown } = useMatchClockField(
  () => clockRaw.value,
  (next) => {
    clockRaw.value = next
    if (next === '') {
      emitDraft({ matchClock: '' })
      return
    }
    const parsed = parseMatchClock(next)
    if (parsed !== null) emitDraft({ matchClock: parsed })
  },
  // The note's clock is optional — "somewhere in this game" is a real thing
  // for a coach to mean — so backspacing off 00:00 gives back no clock.
  { clearable: true },
)

function toggleReviewed(): void {
  emitDraft({ kind: reviewed.value ? 'note' : 'reviewed_only' })
}
</script>

<template>
  <div class="paper coach-note">
    <div class="note-head">
      <span class="eyebrow ink">Your note</span>
      <p
        class="note-save"
        :class="{ 'note-blocked': blocked }"
        role="status"
        aria-label="Note save state"
      >
        {{ statusLine }}
      </p>
    </div>

    <div v-if="filesUnderTags" class="note-chips" role="group" aria-label="Focus tags">
      <button
        v-for="tag in FOCUS_TAGS"
        :key="tag"
        type="button"
        class="paper-chip"
        :aria-pressed="draft.focusTags.includes(tag)"
        :disabled="blocked"
        :title="blocked ? blockedReason : undefined"
        @click="toggleTag('focusTags', tag)"
      >
        {{ focusTagLabel(tag) }}
      </button>
      <button
        v-for="tag in draft.extraTags"
        :key="tag"
        type="button"
        class="paper-chip"
        aria-pressed="true"
        :disabled="blocked"
        @click="toggleTag('extraTags', tag)"
      >
        {{ tag }}
      </button>
      <button
        v-if="!addingTag"
        type="button"
        class="paper-chip note-add"
        :disabled="blocked"
        :title="blocked ? blockedReason : undefined"
        @click="startAddingTag"
      >
        + Add
      </button>
      <input
        v-else
        ref="newTagField"
        v-model="newTag"
        type="text"
        class="note-new-tag"
        spellcheck="false"
        autocomplete="off"
        autocorrect="off"
        aria-label="New focus tag"
        placeholder="focus…"
        @keydown.enter.prevent="commitNewTag"
        @keydown.esc="addingTag = false"
        @blur="commitNewTag"
      >
    </div>

    <!-- Visual furniture, not a <label>: NoteWriter names its own field, and
         a second name (or a `for` pointing at a contenteditable) would be
         announced twice or not at all. -->
    <p class="eyebrow ink note-label">
      Note
    </p>
    <!-- Markdown, and now visibly so. The value stays the plain string the
         wire already carries; every surface that reads it renders the same
         grammar (NoteProse / RenderMarkdown), and so does the editor. -->
    <!-- :key is load-bearing. Moving down the reel changes props on the SAME
         instance (which is why the matchKey watchers above exist), so without
         a key the writer would keep the previous note's Markdown/Formatted
         choice — and, worse for a document model, keep its undo history and
         its editor state across two different players' notes. -->
    <NoteWriter
      :key="matchKey"
      expandable
      :text="draft.text"
      label="Note"
      :placeholder="notePlaceholder"
      :disabled="blocked"
      :tools-disabled="toolsDisabled"
      :disabled-reason="toolsDisabledReason ?? undefined"
      :blocked-reason="blocked ? blockedReason : undefined"
      surface="paper"
      @update:text="emitDraft({ kind: 'note', text: $event })"
    />

    <div class="note-row">
      <div v-if="filesUnderTags" class="note-clock-cell">
        <label class="eyebrow ink note-label" for="coach-note-clock">In-match clock</label>
        <input
          id="coach-note-clock"
          class="note-clock"
          type="text"
          inputmode="numeric"
          spellcheck="false"
          autocomplete="off"
          autocorrect="off"
          :value="clockRaw"
          :aria-describedby="CLOCK_HINT_ID"
          :aria-invalid="clockInvalid ? 'true' : undefined"
          :disabled="blocked"
          placeholder="MM:SS"
          @keydown="onClockKeydown"
        >
        <p :id="CLOCK_HINT_ID" class="note-hint">
          Type the digits — when in the match it happened. For a specific
          play, use Moments above. Optional.
        </p>
      </div>

      <button
        type="button"
        class="paper-chip note-switch"
        role="switch"
        :aria-checked="reviewed"
        :disabled="written || blocked"
        :title="reviewedDisabledReason"
        @click="toggleReviewed"
      >
        {{ switchLabel }}
      </button>
    </div>

    <footer class="note-foot">
      <button type="button" class="paper-btn" :disabled="!hasPrev" @click="emit('prev')">
        Previous match
      </button>
      <button type="button" class="paper-btn" :disabled="!hasNext" @click="emit('next')">
        Next match
      </button>
    </footer>
  </div>
</template>

<style scoped>
.coach-note {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.9rem 1rem 1rem;
}

.note-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.6rem;
}

.note-save {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--type-3xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

/* A block is a refusal, not a status — it takes the loss color and drops
   the shout-case so it reads as a sentence. */
.note-blocked {
  font-family: var(--body);
  font-size: var(--type-md);
  letter-spacing: normal;
  text-transform: none;
  color: var(--paper-loss);
}

.note-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.note-add { border-style: dashed; }

.note-label { margin-top: 0.2rem; }

/* The formatting row. Chips, not buttons with chrome — the note is a sheet
   of paper and the tools sit on it like a stamp set. */
.note-new-tag, .note-clock {
  font-family: var(--body);
  font-size: var(--type-lg);
  color: var(--ink);
  background: var(--paper-2);
  border: 1px solid var(--ink-faint);
  border-radius: var(--radius);
}

.note-new-tag {
  width: 7rem;
  padding: 0.22rem 0.5rem;
  font-family: var(--mono);
  font-size: var(--type-xs);
}


.note-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.8rem;
}

.note-clock-cell {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.note-clock {
  width: 6rem;
  padding: 0.3rem 0.5rem;
  font-family: var(--mono);
  font-feature-settings: "tnum";
}

.note-clock[aria-invalid="true"] {
  border-color: var(--paper-loss);
  border-width: 2px;
}

.note-hint {
  margin: 0;
  font-size: var(--type-2xs);
  color: var(--ink-faint);
}

.note-switch { align-self: center; }

.note-foot {
  display: flex;
  gap: 0.5rem;
  padding-top: 0.4rem;
  border-top: 1px solid var(--paper-rule);
}
</style>
