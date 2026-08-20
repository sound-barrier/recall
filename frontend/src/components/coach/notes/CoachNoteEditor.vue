<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'

import { SAVE_LABEL, type CoachSaveState } from '@/components/coach/room/coach-room-props'
import type { RoomVoice } from '@/components/coach/room/coach-room-props'
import {
  applyInlineMark, applyLineMark, type InlineMark, type LineMark,
} from '@/match/markdown/note-toolbar'
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

const noteField = useTemplateRef<HTMLTextAreaElement>('noteField')
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
const switchLabel = computed(() => (props.voice === 'your' ? 'Nothing to add' : 'Reviewed'))
const statusLine = computed(() => (blocked.value ? props.blockedReason : SAVE_LABEL[props.saveState]))
const reviewedDisabledReason = computed(() => {
  if (blocked.value) return props.blockedReason
  return written.value ? reviewedBlockedReason : undefined
})

function emitDraft(patch: Partial<CoachNoteDraft>): void {
  emit('update', { ...props.draft, ...patch })
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

function onNoteInput(e: Event): void {
  if (!(e.target instanceof HTMLTextAreaElement)) return
  emitDraft({ kind: 'note', text: e.target.value })
}

// The toolbar reads the live selection off the field, asks the pure helper
// for the next (text, selection), emits the draft, and puts the caret back
// where the helper said — the editor is controlled, so the value only
// returns through the prop and the selection would otherwise collapse.
function applyEdit(next: { text: string; start: number; end: number }): void {
  emitDraft({ kind: 'note', text: next.text })
  void nextTick(() => {
    const field = noteField.value
    if (!field) return
    field.focus()
    field.setSelectionRange(next.start, next.end)
  })
}

function markInline(mark: InlineMark): void {
  const field = noteField.value
  if (!field || blocked.value) return
  applyEdit(applyInlineMark(props.draft.text, field.selectionStart, field.selectionEnd, mark))
}

function markLine(mark: LineMark): void {
  const field = noteField.value
  if (!field || blocked.value) return
  applyEdit(applyLineMark(props.draft.text, field.selectionStart, field.selectionEnd, mark))
}

// ⌘/Ctrl+B and +I, the two every text field on every platform answers.
function onNoteKeydown(e: KeyboardEvent): void {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return
  const key = e.key.toLowerCase()
  if (key !== 'b' && key !== 'i') return
  e.preventDefault()
  markInline(key === 'b' ? 'bold' : 'italic')
}

const TOOLBAR_INLINE: readonly { mark: InlineMark; label: string; glyph: string }[] = [
  { mark: 'bold', label: 'Bold', glyph: 'B' },
  { mark: 'italic', label: 'Italic', glyph: 'I' },
  { mark: 'strike', label: 'Strikethrough', glyph: 'S' },
]

const TOOLBAR_LINE: readonly { mark: LineMark; label: string; glyph: string }[] = [
  { mark: 'title', label: 'Title', glyph: 'H1' },
  { mark: 'subtitle', label: 'Subheading', glyph: 'H2' },
  { mark: 'bullet', label: 'Bulleted list', glyph: '•' },
  { mark: 'number', label: 'Numbered list', glyph: '1.' },
]

function onClockInput(e: Event): void {
  if (!(e.target instanceof HTMLInputElement)) return
  clockRaw.value = e.target.value
  if (clockRaw.value.trim() === '') {
    emitDraft({ matchClock: '' })
    return
  }
  const parsed = parseMatchClock(clockRaw.value)
  if (parsed !== null) emitDraft({ matchClock: parsed })
}

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
        aria-label="New focus tag"
        placeholder="focus…"
        @keydown.enter.prevent="commitNewTag"
        @keydown.esc="addingTag = false"
        @blur="commitNewTag"
      >
    </div>

    <label class="eyebrow ink note-label" for="coach-note-text">Note</label>
    <!-- Markdown, written by buttons. The value stays the plain string the
         wire already carries; every surface that reads it renders the same
         grammar (NoteProse / RenderMarkdown). -->
    <div class="note-toolbar" role="toolbar" aria-label="Formatting">
      <button
        v-for="b in TOOLBAR_INLINE"
        :key="b.mark"
        type="button"
        class="paper-chip note-tool"
        :class="{ 'note-tool-em': b.mark === 'italic', 'note-tool-del': b.mark === 'strike' }"
        :aria-label="b.label"
        :disabled="blocked"
        :title="blocked ? blockedReason : b.label"
        @click="markInline(b.mark)"
      >
        {{ b.glyph }}
      </button>
      <span class="note-tool-sep" aria-hidden="true" />
      <button
        v-for="b in TOOLBAR_LINE"
        :key="b.mark"
        type="button"
        class="paper-chip note-tool"
        :aria-label="b.label"
        :disabled="blocked"
        :title="blocked ? blockedReason : b.label"
        @click="markLine(b.mark)"
      >
        {{ b.glyph }}
      </button>
    </div>
    <textarea
      id="coach-note-text"
      ref="noteField"
      class="note-text"
      rows="5"
      :value="draft.text"
      :disabled="blocked"
      :title="blocked ? blockedReason : undefined"
      :placeholder="notePlaceholder"
      @input="onNoteInput"
      @keydown="onNoteKeydown"
    />

    <div class="note-row">
      <div v-if="filesUnderTags" class="note-clock-cell">
        <label class="eyebrow ink note-label" for="coach-note-clock">In-match clock</label>
        <input
          id="coach-note-clock"
          class="note-clock"
          type="text"
          inputmode="numeric"
          :value="clockRaw"
          :aria-describedby="CLOCK_HINT_ID"
          :aria-invalid="clockInvalid ? 'true' : undefined"
          :disabled="blocked"
          placeholder="MM:SS"
          @input="onClockInput"
        >
        <p :id="CLOCK_HINT_ID" class="note-hint">
          MM:SS — when in the match it happened.
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
.note-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
}

.note-tool {
  min-width: 1.9rem;
  justify-content: center;
  font-family: var(--mono);
  font-size: var(--type-3xs);
  font-weight: 700;
}

.note-tool-em { font-style: italic; }
.note-tool-del { text-decoration: line-through; }

.note-tool-sep {
  width: 1px;
  height: 1.1rem;
  margin: 0 0.15rem;
  background: var(--paper-rule);
}

.note-new-tag, .note-text, .note-clock {
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

.note-text {
  padding: 0.5rem 0.6rem;
  line-height: 1.5;
  resize: vertical;
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
