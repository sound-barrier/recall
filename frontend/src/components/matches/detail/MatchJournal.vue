<script setup lang="ts">
import { onMounted, nextTick } from 'vue'
import type { MatchRecord, MatchAnnotationInput } from '@/api'
import { type SearchClause } from '@/match/search-query'
import { useMatchAnnotationEditor } from '@/composables/matches/useMatchAnnotationEditor'

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
}>()

const emit = defineEmits<{
  'set-match-annotation': [matchKey: string, input: MatchAnnotationInput]
  'focus-consumed': []
}>()

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
  (input) => emit('set-match-annotation', props.record.match_key, input),
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
      <span class="journal-head-meta" :data-status="hasAnyNote ? 'logged' : 'empty'">
        <span class="journal-head-pip" aria-hidden="true" />
        {{ hasAnyNote ? 'LOGGED' : 'AWAITING ENTRY' }}
      </span>
    </div>

    <div class="journal-body">
      <!-- Note (primary) — same click-to-edit preview + textarea
             swap as before, just hosted inside the journal cell shell. -->
      <div
        class="journal-cell journal-cell-note"
        :class="{ saved: savedFlash === 'note', filled: !!noteDraft.trim() }"
      >
        <label class="journal-eyebrow" :for="`note-${record.match_key}`">Note</label>
        <div
          v-if="!isEditingNote && noteDraft"
          class="match-notes-preview"
          :class="{ 'has-hits': noteHighlightSegments.some(s => s.hit) }"
          role="textbox"
          aria-readonly="true"
          tabindex="0"
          title="Click to edit"
          @click="enterEditMode"
          @keydown.enter.prevent="enterEditMode($event as unknown as MouseEvent)"
          @keydown.space.prevent="enterEditMode($event as unknown as MouseEvent)"
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
          <label class="journal-eyebrow" :for="`replay-${record.match_key}`">Replay code</label>
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
          <label class="journal-eyebrow" :for="`members-${record.match_key}`">
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
        <span class="journal-eyebrow">
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

<style scoped>
/* ─── Match Journal ──────────────────────────────────────── */

/* The user's annotations on a match — Note, Replay code, Group
   members, Tags. Promoted to its own panel because (a) the user
   explicitly flagged the section as important, and (b) the previous
   one-input-per-row layout took 4× the vertical space the data
   actually needs. New layout:
     1. Striped header strip → reads as a dossier / after-action
        report rather than a generic form.
     2. Cells with their own eyebrow + inline focus-within glow →
        each field feels distinct without forcing 4 horizontal labels.
     3. Replay + Group share a row → reclaims one row of vertical
        space because the replay code is intrinsically narrow.
     4. saved✓ pulse on the cell border (not a 3rd grid column) → no
        layout shift when commit confirms; the affordance lives on
        the cell it confirms. */

.match-journal {
  position: relative;
  margin: 0 0 0.85rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  overflow: hidden;
  transition: border-color 220ms ease, box-shadow 220ms ease;
}

.match-journal.populated {
  border-color: var(--accent-soft);
  box-shadow: inset 2px 0 0 0 var(--accent);
}

/* Corner ticks — fade in when the panel has content so the user gets
   a soft "active dossier" affordance. Off when empty so the empty
   state stays calm. */
.match-journal::before,
.match-journal::after {
  content: '';
  position: absolute;
  width: 8px;
  height: 8px;
  border: 1px solid var(--accent);
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms ease;
}

.match-journal::before {
  top: -1px; right: -1px;
  border-left: none; border-bottom: none;
}

.match-journal::after {
  bottom: -1px; left: -1px;
  border-right: none; border-top: none;
}

.match-journal.populated::before,
.match-journal.populated::after { opacity: 0.7; }

.journal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.7rem;
  padding: 0.4rem 0.7rem 0.4rem 0.75rem;
  background: repeating-linear-gradient(135deg, var(--surface-3) 0 14px, var(--surface-2) 14px 28px);
  border-bottom: 1px solid var(--border);
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.24em;
  text-transform: uppercase;
}

.journal-head-title {
  color: var(--text);
  font-weight: 700;
}

.journal-head-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.58rem;
  letter-spacing: 0.2em;
  color: var(--text-faint);
}

.journal-head-pip {
  width: 6px;
  height: 6px;
  background: currentcolor;
  transform: rotate(45deg);
  opacity: 0.7;
}

.match-journal.populated .journal-head-meta { color: var(--accent); }
.match-journal.populated .journal-head-meta .journal-head-pip { opacity: 1; }

.journal-body {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.7rem 0.75rem 0.8rem;
}

/* Replay + Group share a row; the replay code is short, group is
   wide. On narrow widths the grid collapses to a single column so
   the chip list doesn't squeeze. */
.journal-row-2col {
  display: grid;
  grid-template-columns: minmax(11rem, 0.45fr) 1fr;
  gap: 0.55rem;
}

@media (width <= 720px) {
  .journal-row-2col { grid-template-columns: 1fr; }
}

/* Each cell is a self-contained mini-card: eyebrow up top, control
   below. Focus-within glows the cell with the accent ring so the
   user always knows which field they're editing. */
.journal-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.5rem 0.6rem 0.55rem;
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 2px;
  transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
}

.journal-cell:focus-within {
  border-color: var(--accent);
  background: var(--surface);
  box-shadow: 0 0 0 1px var(--accent-soft);
}

.journal-cell.filled { border-color: var(--border); }

/* Confirmation pulse — the parent flips the `saved` class for 900 ms
   after a commit. Border + tiny corner tick fade through accent
   then back. No layout shift; replaces the prior "saved ✓" text
   column. */
.journal-cell.saved {
  animation: journal-cell-saved 900ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
}

.journal-cell.saved::after {
  content: '';
  position: absolute;
  top: -1px;
  right: -1px;
  width: 14px;
  height: 14px;
  background:
    linear-gradient(135deg, transparent 50%, var(--accent) 50%);
  animation: journal-cell-tick 900ms ease both;
  pointer-events: none;
}

@keyframes journal-cell-saved {
  0%   { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft), 0 0 22px -2px var(--accent-glow); }
  100% { border-color: var(--border); box-shadow: 0 0 0 0 transparent; }
}

@keyframes journal-cell-tick {
  0%   { opacity: 0; transform: translate(-2px, 2px); }
  20%  { opacity: 1; transform: translate(0, 0); }
  100% { opacity: 0; transform: translate(0, 0); }
}

@media (prefers-reduced-motion: reduce) {
  .journal-cell.saved { animation: none; }
  .journal-cell.saved::after { animation: none; opacity: 0; }
}

.journal-eyebrow {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-faint);
  user-select: none;
}

.journal-cell.filled .journal-eyebrow { color: var(--text-dim); }
.journal-cell:focus-within .journal-eyebrow { color: var(--accent); }

.journal-eyebrow-count {
  font-size: 0.58rem;
  letter-spacing: 0.12em;
  color: var(--accent);
  font-feature-settings: "tnum";
}

.journal-cell-note { grid-column: 1 / -1; }

/* The note + replay + members fields all share the same control
   chrome — borderless inputs that sit flush inside their journal
   cell. The cell IS the visual frame; the input is just text. */
.match-notes-textarea,
.match-notes-input,
.match-notes-preview {
  width: 100%;
  padding: 0.25rem 0;
  background: transparent;
  border: 0;
  color: var(--text);
  font: inherit;
  font-size: 0.85rem;
  line-height: 1.45;
}

.match-notes-textarea,
.match-notes-preview {
  min-height: 2.2rem;
  font-family: var(--body);
}

.match-notes-textarea {
  resize: vertical;
  outline: none;
}

.match-notes-input { outline: none; }

/* HUD-style preview — cursor: text + the focus-within glow on the
   parent cell signal "editable" without a pencil icon. The ⌕ pinned
   right confirms the active match-search query landed at least one
   hit inside this note. */
.match-notes-preview {
  position: relative;
  padding-right: 1.6rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  cursor: text;
}

.match-notes-preview:focus-visible { outline: none; }

.match-notes-preview.has-hits::after {
  content: "⌕";
  position: absolute;
  top: 0.05rem;
  right: 0.1rem;
  font-family: var(--mono);
  font-size: 0.8rem;
  color: var(--accent);
  opacity: 0.9;
  pointer-events: none;
}

/* "Target acquired" mark: accent-soft fill + 2px accent under-rule,
   sharp corners (OW HUD, not notion soft-pill). decoration-break
   makes wrap-to-next-line marks get the under-rule too. */
.match-notes-preview :deep(mark.note-hit) {
  background: var(--accent-soft);
  color: var(--text);
  border-radius: 0;
  padding: 0 2px;
  margin: 0 1px;
  box-shadow: inset 0 -2px 0 0 var(--accent);
  box-decoration-break: clone;
}

@media (prefers-reduced-motion: no-preference) {
  .match-notes-preview :deep(mark.note-hit) {
    animation: note-hit-acquire 220ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
}

@keyframes note-hit-acquire {
  from { background: transparent; box-shadow: inset 0 -2px 0 0 transparent; }
}

.match-notes-input.mono {
  font-family: var(--mono);
  letter-spacing: 0.04em;
}

/* Members chip list — flex-wraps so chips reflow on narrow widths.
   The host journal cell owns the border + focus glow, so the chip
   tray itself is borderless. */
.match-notes-members {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: center;
  padding: 0.05rem 0;
}

.member-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.18rem 0.2rem 0.18rem 0.5rem;
  background: var(--accent-soft);
  border: 1px solid var(--accent);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.02em;
  color: var(--accent);
}

.member-chip-tag {
  white-space: nowrap;
}

.member-chip-remove {
  appearance: none;
  background: transparent;
  border: 0;
  padding: 0 0.2rem;
  color: currentcolor;
  cursor: pointer;
  font-size: 0.85rem;
  line-height: 1;
  border-radius: 1px;
  transition: background 140ms ease;
}

.member-chip-remove:hover {
  background: color-mix(in srgb, currentcolor 18%, transparent);
}

.member-input {
  flex: 1 1 11rem;
  min-width: 8rem;
  padding: 0.15rem 0;
  background: transparent;
  border: 0;
  font-size: 0.78rem;
  outline: none;
}

/* Tags editor sits flush inside .journal-cell-tags — kill the
   margin-top app.css adds since the parent journal cell already
   provides the gap. */
.journal-cell-tags .match-tags-editor { margin-top: 0; }
</style>
