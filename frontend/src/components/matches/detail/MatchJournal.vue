<script setup lang="ts">
import { onMounted, nextTick } from 'vue'
import type { MatchRecord } from '@/api-client'
import { type SearchClause } from '@/match/search-query'
import { useMatchAnnotationEditor } from '@/composables/matches/useMatchAnnotationEditor'
import { useMatchActions } from '@/composables/matches/useMatchActions'

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
const { onSetMatchAnnotation } = useMatchActions()

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
  if (props.pendingFocus === 'note' || props.pendingFocus === 'tag') {
    void nextTick().then(() => {
      const id = props.pendingFocus === 'note'
        ? `note-${props.record.match_key}`
        : `tags-${props.record.match_key}`
      const el = document.getElementById(id) as HTMLElement | null
      el?.focus()
      emit('focus-consumed')
    })
  }
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
          title="Click to edit"
          @click="enterEditMode"
          @keydown.enter.prevent="enterEditMode"
          @keydown.space.prevent="enterEditMode"
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
              :aria-label="`Remove ${t} tag`"
              @click="removeTag(t)"
            >×</button>
          </span>
          <div class="match-tag-input-wrap">
            <input
              :id="`tags-${record.match_key}`"
              v-model="tagInput"
              class="match-tag-input"
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
    </div>
  </section>
</template>

<style scoped src="./match-journal.css"></style>
