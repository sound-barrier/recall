import { ref, computed, watch, nextTick } from 'vue'
import type { MatchRecord, MatchAnnotationInput } from '@/api'
import { highlightSubstrings } from '@/match/match-helpers'
import { highlightTermsFor, type SearchClause } from '@/match/search-query'

// The expanded match card's annotation editor: the free-text drafts
// (note / replay / members / tags), the click-to-edit note surface with
// caret restore + FilterRail hit highlighting, the member chip list, and
// the tag chip list with inline autocomplete. Extracted from
// MatchCardExpanded.vue so the SFC holds layout and this composable holds
// the editor's stateful logic. Drafts hydrate from the record's annotation
// and re-sync when it changes; every commit writes all the fields at once
// via emitAnnotation so a single setter round-trip can't drop a field.
export function useMatchAnnotationEditor(
  record: () => MatchRecord,
  emitAnnotation: (input: MatchAnnotationInput) => void,
  searchClauses: () => SearchClause[],
  availableTags: () => string[],
) {
// Local draft state for the free-text annotation fields. Hydrates
// from record().annotation when the card opens or the underlying
// record changes; the user types here and we emit on commit
// (blur for note/replay, Enter for chip-add inputs).
const noteDraft       = ref(record().annotation?.note ?? '')
const replayDraft     = ref(record().annotation?.replay_code ?? '')
const memberInput     = ref('')
const memberDraft     = ref<string[]>(record().annotation?.members ?? [])
const tagInput        = ref('')
const tagDraft        = ref<string[]>(record().annotation?.tags ?? [])
// Track which annotation field, if any, just saved so a "saved ✓"
// pulse can render without stomping on the active editor's value.
const savedFlash      = ref<'' | 'note' | 'replay' | 'members' | 'tags'>('')

// The three conventional tags. Order here is presentation order in
// the quick-add row; the user can still add anything via free-form.
const NAMED_TAGS = ['stack', 'stream', 'placement'] as const

watch(
  () => record().annotation,
  (next) => {
    noteDraft.value = next?.note ?? ''
    replayDraft.value = next?.replay_code ?? ''
    memberDraft.value = next?.members ?? []
    tagDraft.value = next?.tags ?? []
  },
  { immediate: false },
)

const hasAnyNote = computed(
  () => !!(noteDraft.value.trim() || replayDraft.value.trim() || memberDraft.value.length || tagDraft.value.length),
)

// Click-to-edit state for the Note row. The preview is the default
// surface when the note is non-empty: a div renders the note text
// with <mark> around the live FilterRail substring matches. Click
// promotes to the existing textarea editor (focused at the click
// position via the cached caret offset); blur reverts to preview.
//
// An empty note skips the preview swap entirely — the textarea
// stays mounted so the user can type their first character without
// an extra click.
const isEditingNote   = ref(false)
const noteTextareaRef = ref<HTMLTextAreaElement | null>(null)
let pendingCaretPos: number | null = null

const noteHighlightSegments = computed(() =>
  highlightSubstrings(noteDraft.value, highlightTermsFor('note', searchClauses())),
)

// Compute a 0-based offset into `text` from a click DOM position
// (node + offset-inside-node) inside a preview container whose
// children are a flat list of text nodes and <mark> wrappers (each
// containing exactly one text node). Walks descendants in document
// order, summing the lengths of preceding text content until the
// click target is reached. Returns null when the click landed on
// something we can't translate (defensive — falls back to focusing
// the end of the textarea).
function caretOffsetFromClick(
  container: HTMLElement,
  node: Node,
  offsetInNode: number,
): number | null {
  let acc = 0
  let found = false
  const walk = (n: Node): void => {
    if (found) return
    if (n === node) {
      acc += offsetInNode
      found = true
      return
    }
    if (n.nodeType === Node.TEXT_NODE) {
      acc += (n.textContent ?? '').length
      return
    }
    if (!container.contains(n) && n !== container) return
    n.childNodes.forEach(walk)
  }
  walk(container)
  return found ? acc : null
}

function enterEditMode(e: MouseEvent) {
  const container = e.currentTarget as HTMLElement
  // Prefer the standard API; fall back to the WebKit-only name.
  type CaretPositionFromPoint = (x: number, y: number) => { offsetNode: Node, offset: number } | null
  type CaretRangeFromPoint = (x: number, y: number) => Range | null
  type DocWithCaretAPIs = Document & {
    caretPositionFromPoint?: CaretPositionFromPoint
    caretRangeFromPoint?: CaretRangeFromPoint
  }
  const doc: DocWithCaretAPIs = document
  let clickedNode: Node | null = null
  let clickedOffset = 0
  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(e.clientX, e.clientY)
    if (pos) { clickedNode = pos.offsetNode; clickedOffset = pos.offset }
  } else if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(e.clientX, e.clientY)
    if (range) { clickedNode = range.startContainer; clickedOffset = range.startOffset }
  }
  pendingCaretPos = clickedNode
    ? caretOffsetFromClick(container, clickedNode, clickedOffset)
    : null

  isEditingNote.value = true
  void nextTick(() => {
    const ta = noteTextareaRef.value
    if (!ta) return
    ta.focus()
    const len = ta.value.length
    const pos = pendingCaretPos === null ? len : Math.max(0, Math.min(pendingCaretPos, len))
    ta.setSelectionRange(pos, pos)
    pendingCaretPos = null
  })
}

function exitNoteEditMode() {
  commitAnnotation('note')
  isEditingNote.value = false
}

// Commits the current draft to the parent. Always writes ALL FIVE
// annotation fields so the unified setter doesn't accidentally null
// something the user typed in another input. Leaver is read from the
// existing annotation (the chooser owns that field independently).
function commitAnnotation(field: 'note' | 'replay' | 'members' | 'tags') {
  emitAnnotation({
    leaver:      (record().annotation?.leaver ?? '') as MatchAnnotationInput['leaver'],
    note:        noteDraft.value.trim(),
    replay_code: replayDraft.value.trim(),
    members:     memberDraft.value,
    tags:        tagDraft.value,
  })
  savedFlash.value = field
  setTimeout(() => { if (savedFlash.value === field) savedFlash.value = '' }, 900)
}

function addMember() {
  const v = memberInput.value.trim()
  if (!v || memberDraft.value.includes(v)) {
    memberInput.value = ''
    return
  }
  memberDraft.value = [...memberDraft.value, v]
  memberInput.value = ''
  commitAnnotation('members')
}

function removeMember(name: string) {
  memberDraft.value = memberDraft.value.filter(m => m !== name)
  commitAnnotation('members')
}

// Keydown handler for the member input. Enter/comma both commit the
// chip (Vue's v-on doesn't support the `comma` key modifier so we
// have to read e.key by hand). Backspace on an empty input removes
// the last chip — standard tagify-style behaviour.
function onMemberKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    addMember()
    return
  }
  if (e.key === 'Backspace' && memberInput.value === '' && memberDraft.value.length > 0) {
    e.preventDefault()
    removeMember(memberDraft.value[memberDraft.value.length - 1]!)
  }
}

// Tags mirror the members editor pattern (chip list + free-form
// input) but with three quick-add toggles for the conventional tag
// vocabulary. The server lowercases + dedupes on persist; the
// client mirrors so the optimistic UI matches the round-tripped
// state byte-for-byte.
function normalizeTagLabel(t: string): string {
  return t.trim().toLowerCase()
}

function hasTag(t: string): boolean {
  return tagDraft.value.includes(normalizeTagLabel(t))
}

function toggleNamedTag(t: string) {
  const v = normalizeTagLabel(t)
  if (!v) return
  tagDraft.value = hasTag(v)
    ? tagDraft.value.filter(x => x !== v)
    : [...tagDraft.value, v]
  commitAnnotation('tags')
}

function addCustomTag() {
  const v = normalizeTagLabel(tagInput.value)
  if (!v) {
    tagInput.value = ''
    return
  }
  if (!tagDraft.value.includes(v)) {
    tagDraft.value = [...tagDraft.value, v]
    commitAnnotation('tags')
  }
  tagInput.value = ''
}

function removeTag(t: string) {
  tagDraft.value = tagDraft.value.filter(x => x !== t)
  commitAnnotation('tags')
}

// ── Inline tag autocomplete ─────────────────────────────────────
//
// Suggestions surface beneath the tag input while it has focus +
// non-empty content. The vocabulary comes from the availableTags arg
// (sorted across the narrowed set by `useMatchesNarrow`), minus the
// tags already on this record (so the user can't suggest themselves
// what they've already picked) and minus the conventional
// NAMED_TAGS quick-add tokens (shown as toggle buttons inline).
//
// Cursor lives at -1 when nothing is keyboard-highlighted. Mouseenter
// on a suggestion takes the cursor; ArrowDown/Up cycle; Enter on the
// cursor adopts; Enter without cursor falls to the existing
// addCustomTag() (free-text adopt). Click — via mousedown.prevent
// so the input keeps focus — adopts the suggestion.

const tagSuggestionsOpen = ref(false)
const tagCursor          = ref(-1)

const tagSuggestions = computed<string[]>(() => {
  const universe = availableTags()
  if (universe.length === 0) return []
  const q = normalizeTagLabel(tagInput.value)
  const exclude = new Set<string>([
    ...tagDraft.value,
    ...NAMED_TAGS as readonly string[],
  ])
  const pool = universe.filter(t => !exclude.has(t))
  if (!q) return pool
  // Prefix match (consistent with the map/hero pickers): "sto" surfaces
  // "stomp", "tom" doesn't.
  return pool.filter(t => t.startsWith(q))
})

watch(tagSuggestions, () => {
  if (tagCursor.value >= tagSuggestions.value.length) tagCursor.value = -1
})

function onTagFocus() {
  tagSuggestionsOpen.value = true
}

function onTagBlur() {
  // Defer so a mousedown.prevent on a suggestion still fires before
  // close. addCustomTag already runs on blur via the v-bind handler.
  setTimeout(() => {
    tagSuggestionsOpen.value = false
    tagCursor.value = -1
  }, 120)
  addCustomTag()
}

function adoptSuggestion(t: string) {
  if (!tagDraft.value.includes(t)) {
    tagDraft.value = [...tagDraft.value, t]
    commitAnnotation('tags')
  }
  tagInput.value = ''
  tagCursor.value = -1
}

function onTagKeydown(e: KeyboardEvent) {
  const sugs = tagSuggestions.value
  const len  = sugs.length
  const open = tagSuggestionsOpen.value && len > 0
  switch (e.key) {
    case 'ArrowDown':
      if (!open) return
      e.preventDefault()
      tagCursor.value = (tagCursor.value + 1) % len
      return
    case 'ArrowUp':
      if (!open) return
      e.preventDefault()
      tagCursor.value = (tagCursor.value - 1 + len) % len
      return
    case 'Enter':
    case ',':
      e.preventDefault()
      if (open && tagCursor.value >= 0 && tagCursor.value < len) {
        adoptSuggestion(sugs[tagCursor.value]!)
        return
      }
      addCustomTag()
      return
    case 'Escape':
      if (open) {
        e.preventDefault()
        tagSuggestionsOpen.value = false
        tagCursor.value = -1
      }
      return
    case 'Backspace':
      if (tagInput.value === '' && tagDraft.value.length > 0) {
        e.preventDefault()
        removeTag(tagDraft.value[tagDraft.value.length - 1]!)
      }
      return
  }
}

  return {
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
  }
}
