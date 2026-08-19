<script setup lang="ts">
import { computed, onMounted, nextTick, ref } from 'vue'
import type { MatchRecord } from '@/api-client'
import { type SearchClause } from '@/match/search-query'
import CoachCueStrip from '@/components/coach/notes/CoachCueStrip.vue'
import CoachNoteBlock from '@/components/coach/notes/CoachNoteBlock.vue'
import { coachBlockView, selfBlockView } from '@/match/coach/note-block-view'
import { fromWireMoment, isSavable, type CoachMoment } from '@/match/coach/coach-moments'
import { useCoachAutosave } from '@/composables/coach/useCoachAutosave'
import { useMatchAnnotationEditor } from '@/composables/matches/detail/useMatchAnnotationEditor'
import { useMatchActions } from '@/composables/matches/useMatchActions'
import { useWriteGate } from '@/composables/shared/useWriteGate'

// The expanded match card's MATCH JOURNAL — note / replay / squad / tags
// editor. Owns useMatchAnnotationEditor (the draft state + commit logic)
// and renders the journal cells. Extracted from MatchCardExpanded so the
// card SFC sheds the journal's template + scoped CSS; the card just passes
// the record down and forwards the annotation / focus events back up.
const props = defineProps<{
  record: MatchRecord
  searchClauses?: SearchClause[]
  availableTags?: string[]
  // One-shot focus target from the right-click menu's Tag / Edit
  // annotation actions: focus the matching input on mount, then emit
  // focus-consumed so the parent can clear its pending-focus state.
  pendingFocus?: '' | 'note' | 'tag'
  // The chronologically previous annotated match (threaded from
  // MatchDetailPanel like availableTags) — the source for the head's
  // "Apply previous" one-click copy of members + tags into the draft.
  // Absent/null hides the affordance.
  applySource?: Pick<MatchRecord, 'match_key' | 'annotation'> | null
}>()

const emit = defineEmits<{
  'focus-consumed': []
}>()

// Store-direct write (the UnknownMapsView / UnknownUnmatchedSection
// precedent): calling the action here, instead of emitting up the panel
// chain, lets its Promise<boolean> outcome reach the editor so the
// "saved" pulse is a real persistence receipt.
const {
  onSetMatchAnnotation, onCopyReplayCode, onSetMatchMoment, onDeleteMatchMoment,
} = useMatchActions()

// A coach's moments point at seconds inside a replay, so the block offers the
// code beside them. Same routine the row context menu uses — it names the
// match, looks the code up, and surfaces the one failure worth telling the
// user about (there isn't one on file).
// Rows being written, held here until the server takes them.
//
// The record is the truth for anything saved, so a draft OVERRIDES the stored
// row it edits rather than sitting beside it. Appending was wrong twice over:
// a moment whose text was cleared fell through both branches and reverted to
// its stored words on the next render, and once a refetch landed mid-save the
// same moment rendered twice, with duplicate DOM ids.
const drafts = ref<CoachMoment[]>([])

// Written to the server by THIS component. props.record only catches up on
// the next refetch, so between the two a moment is on the server and not yet
// in the record — and a remove in that window must delete rather than 404.
const savedIds = new Set<string>()

const { saveStateFor, queueSave, cancelSave } = useCoachAutosave()

const stored = computed(() => (props.record.moments ?? []).map(fromWireMoment))

const moments = computed<CoachMoment[]>(() => {
  const edited = new Map(drafts.value.map((d) => [d.momentId, d]))
  const known = new Set(stored.value.map((m) => m.momentId))
  return [
    ...stored.value.map((m) => edited.get(m.momentId) ?? m),
    ...drafts.value.filter((d) => !known.has(d.momentId)),
  ]
})

function holdDraft(moment: CoachMoment) {
  const at = drafts.value.findIndex((d) => d.momentId === moment.momentId)
  drafts.value = at < 0
    ? [...drafts.value, moment]
    : drafts.value.map((d, i) => (i === at ? moment : d))
}

function onMomentUpdate(moment: CoachMoment) {
  holdDraft(moment)
  // A row that does not yet say enough stays local: PUTting it is a 400 on
  // the clock rules, and would leave a row pointing at nothing.
  if (!isSavable(moment)) return
  // Debounced, and keyed on the moment — the journal writes on every
  // keystroke, and each write refetches the match corpus behind it. Keying on
  // the match instead would collapse three moments into whichever typed last.
  queueSave(moment.momentId, async () => {
    const saved = await onSetMatchMoment(props.record.match_key, moment.momentId, {
      match_clock: moment.matchClock,
      text: moment.text,
      ...(moment.focusTag ? { focus_tag: moment.focusTag } : {}),
    })
    // A refused write keeps the draft, so the row stays on screen holding what
    // the player typed rather than reverting their words for them.
    if (!saved) throw new Error('the server refused this moment')
    savedIds.add(moment.momentId)
    drafts.value = drafts.value.filter((d) => d.momentId !== moment.momentId)
  })
}

function onMomentRemove(momentId: string) {
  const wasDraft = drafts.value.some((d) => d.momentId === momentId)
  drafts.value = drafts.value.filter((d) => d.momentId !== momentId)
  // Whatever was still settling for this row is moot now — and would write it
  // back a moment after the server was told to drop it.
  cancelSave(momentId)
  const onServer = savedIds.has(momentId) || stored.value.some((m) => m.momentId === momentId)
  // Never written means nothing to delete: asking would 404.
  if (!onServer && wasDraft) return
  savedIds.delete(momentId)
  void onDeleteMatchMoment(props.record.match_key, momentId)
}

function onCopyReplay() {
  void onCopyReplayCode(props.record.match_key)
}

// Read-only sample profile or an open coaching session: the journal is the
// player's own writing surface, and neither state may write to it. The
// coach's own notes are written in the Film Room, not here.
const { writesLocked, lockReason, lockedTitle } = useWriteGate()

// The coach-received layer — one block per coach and session — and the
// player's own sitting blocks, one per sitting, alongside (never merged
// into) the player's own note. Oldest first within each family, coach
// blocks first: the coach's words are the ones that came from outside.
const noteBlocks = computed(() => [
  ...(props.record.coach_notes ?? []).map((n) => ({ key: `coach-${n.id}`, view: coachBlockView(n) })),
  ...(props.record.self_review_notes ?? []).map((n) => ({ key: `self-${n.review_id}`, view: selfBlockView(n) })),
])

function enterEditModeIfWritable(e: MouseEvent | KeyboardEvent) {
  if (writesLocked.value) return
  enterEditMode(e)
}

const {
  noteDraft,
  replayDraft,
  memberInput,
  memberDraft,
  tagInput,
  tagDraft,
  savedFlash,
  NAMED_TAGS,
  hasAnyNote,
  isEditingNote,
  noteTextareaRef,
  noteHighlightSegments,
  enterEditMode,
  exitNoteEditMode,
  commitAnnotation,
  applyPending,
  applyAnnotationDraft,
  confirmAppliedAnnotation,
  undoAppliedAnnotation,
  addMember,
  removeMember,
  onMemberKeydown,
  hasTag,
  toggleNamedTag,
  removeTag,
  tagSuggestionsOpen,
  tagCursor,
  tagSuggestions,
  onTagFocus,
  onTagBlur,
  adoptSuggestion,
  onTagKeydown,
} = useMatchAnnotationEditor(
  () => props.record,
  (input) => onSetMatchAnnotation(props.record.match_key, input),
  () => props.searchClauses ?? [],
  () => props.availableTags ?? [],
)

onMounted(() => {
  // Apply one-shot focus from the right-click menu (Tag / Edit
  // annotation), looked up by the canonical id the inputs render with —
  // match_key-scoped so stacked cards don't collide.
  const target = props.pendingFocus
  if (target !== 'note' && target !== 'tag') return
  // A match that already HAS a note renders the read-only preview, and the
  // preview carries no id — so "Edit annotation" on exactly the matches
  // worth editing used to focus nothing. Promote to the editor first.
  if (target === 'note') isEditingNote.value = true
  void nextTick().then(() => {
    const id = target === 'note'
      ? `note-${props.record.match_key}`
      : `tags-${props.record.match_key}`
    document.getElementById(id)?.focus()
    emit('focus-consumed')
  })
})
</script>

<template>
  <section
    class="match-journal"
    :class="{ populated: hasAnyNote }"
    :aria-label="`Match journal — ${hasAnyNote ? 'has annotations' : 'empty'}`"
  >
    <div class="journal-head">
      <span class="journal-head-title">MATCH JOURNAL</span>
      <span class="journal-head-actions">
        <template v-if="applyPending">
          <button
            type="button"
            class="journal-apply-btn"
            data-journal-apply-confirm
            :aria-label="`Confirm members and tags copied from ${applySource?.match_key ?? 'the previous match'}`"
            @click="confirmAppliedAnnotation"
          >
            Confirm
          </button>
          <button
            type="button"
            class="journal-apply-btn undo"
            data-journal-apply-undo
            aria-label="Undo the applied annotation"
            @click="undoAppliedAnnotation"
          >
            Undo
          </button>
        </template>
        <button
          v-else-if="applySource"
          type="button"
          class="journal-apply-btn"
          data-journal-apply
          :disabled="writesLocked"
          :title="lockReason || undefined"
          :aria-label="`Apply members and tags from ${applySource.match_key}`"
          @click="applyAnnotationDraft(applySource.annotation ?? {})"
        >
          Apply previous
        </button>
        <span class="journal-head-meta" :data-status="hasAnyNote ? 'logged' : 'empty'">
          <span class="journal-head-pip" aria-hidden="true" />
          {{ hasAnyNote ? 'LOGGED' : 'AWAITING ENTRY' }}
        </span>
      </span>
    </div>

    <div class="journal-body">
      <!-- Note (primary) — same click-to-edit preview + textarea
             swap as before, just hosted inside the journal cell shell. -->
      <div
        class="journal-cell journal-cell-note"
        :class="{ saved: savedFlash === 'note', filled: !!noteDraft.trim() }"
      >
        <label class="eyebrow journal-eyebrow" :for="`note-${record.match_key}`">Note</label>
        <div
          v-if="!isEditingNote && noteDraft"
          class="match-notes-preview"
          :class="{ 'has-hits': noteHighlightSegments.some(s => s.hit) }"
          role="textbox"
          aria-readonly="true"
          tabindex="0"
          :title="lockedTitle('Click to edit')"
          @click="enterEditModeIfWritable"
          @keydown.enter.prevent="enterEditModeIfWritable"
          @keydown.space.prevent="enterEditModeIfWritable"
        >
          <template v-for="(seg, i) in noteHighlightSegments" :key="i">
            <mark v-if="seg.hit" class="note-hit">{{ seg.text }}</mark>
            <template v-else>
              {{ seg.text }}
            </template>
          </template>
        </div>
        <textarea
          v-else
          :id="`note-${record.match_key}`"
          ref="noteTextareaRef"
          v-model="noteDraft"
          class="match-notes-textarea"
          rows="2"
          :disabled="writesLocked"
          :title="lockReason || undefined"
          placeholder="What happened this match? Mistakes, wins, who was carrying…"
          @blur="exitNoteEditMode"
        />
      </div>

      <!-- Replay + Squad on one row — the replay code is intrinsically
             short (~10 chars), so pairing it with the wider Squad chip
             tray reclaims the vertical space the 4-row layout wasted. -->
      <div class="journal-row-2col">
        <div
          class="journal-cell journal-cell-replay"
          :class="{ saved: savedFlash === 'replay', filled: !!replayDraft.trim() }"
        >
          <label class="eyebrow journal-eyebrow" :for="`replay-${record.match_key}`">Replay code</label>
          <input
            :id="`replay-${record.match_key}`"
            v-model="replayDraft"
            class="match-notes-input mono"
            :disabled="writesLocked"
            :title="lockReason || undefined"
            placeholder="e.g. 7H1K9P"
            spellcheck="false"
            autocomplete="off"
            maxlength="32"
            @blur="commitAnnotation('replay')"
            @keydown.enter.prevent="commitAnnotation('replay')"
          >
        </div>

        <div
          class="journal-cell journal-cell-squad"
          :class="{ saved: savedFlash === 'members', filled: memberDraft.length > 0 }"
        >
          <label class="eyebrow journal-eyebrow" :for="`members-${record.match_key}`">
            Group
            <span v-if="memberDraft.length" class="journal-eyebrow-count">· {{ memberDraft.length }}</span>
          </label>
          <div class="match-notes-members">
            <span
              v-for="m in memberDraft"
              :key="m"
              class="member-chip"
            >
              <span class="member-chip-tag">{{ m }}</span>
              <button
                type="button"
                class="member-chip-remove"
                :disabled="writesLocked"
                :title="lockReason || undefined"
                :aria-label="`Remove ${m} from group`"
                @click="removeMember(m)"
              >
                ×
              </button>
            </span>
            <input
              :id="`members-${record.match_key}`"
              v-model="memberInput"
              class="match-notes-input member-input mono"
              :disabled="writesLocked"
              :title="lockReason || undefined"
              :placeholder="memberDraft.length ? 'Add BattleTag…' : 'Add BattleTag · Enter to confirm'"
              spellcheck="false"
              autocomplete="off"
              @keydown="onMemberKeydown"
              @blur="addMember"
            >
          </div>
        </div>
      </div>

      <!-- Tags — three quick-add toggles for the conventional vocabulary,
             a chip list of currently-applied custom tags, and a free-form
             input. Backspace on an empty input removes the last chip. -->
      <div
        class="journal-cell journal-cell-tags"
        :class="{ saved: savedFlash === 'tags', filled: tagDraft.length > 0 }"
      >
        <span class="eyebrow journal-eyebrow">
          Tags
          <span v-if="tagDraft.length" class="journal-eyebrow-count">· {{ tagDraft.length }}</span>
        </span>
        <div class="match-tags-editor">
          <button
            v-for="t in NAMED_TAGS"
            :key="t"
            type="button"
            class="match-tag-toggle"
            :class="{ active: hasTag(t) }"
            :data-tag="t"
            :data-tag-add="t"
            :disabled="writesLocked"
            :title="lockReason || undefined"
            :aria-pressed="hasTag(t)"
            @click="toggleNamedTag(t)"
          >
            <span class="match-tag-mark" aria-hidden="true" />
            <span class="match-tag-text">{{ t }}</span>
          </button>
          <span
            v-for="t in tagDraft.filter(x => !(NAMED_TAGS as readonly string[]).includes(x))"
            :key="t"
            class="match-tag removable"
            :data-tag="t"
          >
            <span class="match-tag-mark" aria-hidden="true" />
            <span class="match-tag-text">{{ t }}</span>
            <button
              type="button"
              class="match-tag-x"
              :disabled="writesLocked"
              :title="lockReason || undefined"
              :aria-label="`Remove ${t} tag`"
              @click="removeTag(t)"
            >×</button>
          </span>
          <div class="match-tag-input-wrap">
            <input
              :id="`tags-${record.match_key}`"
              v-model="tagInput"
              class="match-tag-input"
              :disabled="writesLocked"
              :title="lockReason || undefined"
              placeholder="add tag"
              spellcheck="false"
              autocomplete="off"
              role="combobox"
              aria-autocomplete="list"
              :aria-controls="`tags-${record.match_key}-suggestions`"
              :aria-expanded="tagSuggestionsOpen && tagSuggestions.length > 0 ? 'true' : 'false'"
              :aria-activedescendant="tagCursor >= 0 && tagCursor < tagSuggestions.length
                ? `tags-${record.match_key}-sug-${tagCursor}` : undefined"
              @keydown="onTagKeydown"
              @focus="onTagFocus"
              @blur="onTagBlur"
            >
            <ul
              v-if="tagSuggestionsOpen && tagSuggestions.length > 0"
              :id="`tags-${record.match_key}-suggestions`"
              class="match-tag-suggestions"
              role="listbox"
              aria-label="Tag suggestions"
            >
              <li
                v-for="(s, i) in tagSuggestions"
                :id="`tags-${record.match_key}-sug-${i}`"
                :key="s"
                :class="{ cursor: i === tagCursor }"
                role="option"
                :aria-selected="i === tagCursor ? 'true' : 'false'"
                @mousedown.prevent="adoptSuggestion(s)"
                @mouseenter="tagCursor = i"
              >
                {{ s }}
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!--
        The player's OWN cue strip — the same component the coach's film room
        uses, on their own match. Above the coach layer because these are the
        player's words: a coach speaks in their own block below.
      -->
      <CoachCueStrip
        class="journal-moments"
        :moments="moments"
        :game-length="record.data?.game_length ?? ''"
        :replay-code="record.annotation?.replay_code ?? ''"
        :blocked="writesLocked"
        :blocked-reason="lockReason"
        :save-state-for="saveStateFor"
        @update="onMomentUpdate"
        @remove="onMomentRemove"
        @copy-replay="onCopyReplay"
      />

      <!-- The coach layer and the player's own sittings: one block per coach
           and session, one per sitting, below the player's own entry and
           never merged into it. -->
      <CoachNoteBlock
        v-for="block in noteBlocks"
        :key="block.key"
        :match-key="record.match_key"
        :block="block.view"
        :replay-code="record.annotation?.replay_code ?? ''"
        @copy-replay="onCopyReplay"
      />
    </div>
  </section>
</template>

<style scoped src="./match-journal.css"></style>
