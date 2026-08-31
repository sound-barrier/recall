import { ref, computed, watch, nextTick } from 'vue'
import type { ExclusionReason, MatchRecord, MatchAnnotationInput } from '@/api-client'
import { notePlainText } from '@/match/markdown/note-blocks'
import { highlightTermsFor, type SearchClause } from '@/match/search-query'

// The expanded match card's annotation editor: the free-text drafts
// (note / replay / members / tags), the click-to-edit note surface with
// caret restore + FilterRail hit highlighting, the member chip list, and
// the tag chip list with inline autocomplete. Extracted from
// MatchCardExpanded.vue so the SFC holds layout and this composable holds
// the editor's stateful logic. Drafts hydrate from the record's annotation
// and re-sync when it changes; every commit writes all the fields at once
// via emitAnnotation so a single setter round-trip can't drop a field.
// Which journal cell just saved. Named because two functions now set it
// and a widening union has to widen in one place.
type SavedField = 'note' | 'replay' | 'members' | 'tags' | 'exclusion'

export function useMatchAnnotationEditor(
  record: () => MatchRecord,
  // May return the persist outcome: `false` (or a promise of it) means the
  // write failed and the "saved" pulse must not fire. A void return keeps
  // the fire-and-forget contract for callers without outcome reporting.
  emitAnnotation: (input: MatchAnnotationInput) => void | boolean | Promise<void | boolean>,
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
const savedFlash      = ref<SavedField | ''>('')

// The conventional tags. Order here is presentation order in the
// quick-add row; the user can still add anything via free-form.
// `placement` used to sit here too — it now has its own field, because
// only the exclusion reason reaches the win rate. Existing
// `tag:placement` rows keep working as ordinary tags.
const NAMED_TAGS = ['stack', 'stream'] as const

watch(
  () => record().annotation,
  (next) => {
    noteDraft.value = next?.note ?? ''
    replayDraft.value = next?.replay_code ?? ''
    memberDraft.value = next?.members ?? []
    tagDraft.value = next?.tags ?? []
    // A refreshed annotation supersedes an in-flight apply — the drafts
    // it snapshotted no longer describe the record.
    applyPending.value = false
    applySnapshot = null
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
/**
 * The note field, whatever it currently is. A WYSIWYG in Formatted mode, a
 * textarea in Markdown mode — both answer focus(offset), which is all this
 * needs and all it should know.
 */
const noteFieldRef = ref<{ focus: (offset?: number) => void } | null>(null)
let pendingCaretPos: number | null = null

// The TERMS, not pre-split segments. The note is rendered markdown on both
// sides now — a read view and a live editor — and neither can take a flat list
// of text runs: the read view has to weave <mark> through the markup, and the
// editor draws its hits as decorations over a document it must not touch.
const noteHighlightTerms = computed(() => highlightTermsFor('note', searchClauses()))

/**
 * Whether the active search landed inside this note — the ⌕ the preview pins
 * to its top right.
 *
 * Asked of the note's TEXT, not its source: a word wrapped in emphasis was
 * unfindable while the highlighter walked the raw markdown, so a note whose
 * only hit was `**the high ground**` said it had none.
 */
const noteHasHits = computed(() => {
  const terms = noteHighlightTerms.value.filter((t) => t !== '')
  if (terms.length === 0) return false
  const text = notePlainText(noteDraft.value).toLowerCase()
  return terms.some((t) => text.includes(t.toLowerCase()))
})

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

// Entered from both a mouse click (caret lands at the click point) and keyboard
// Enter/Space (no point — the cursor falls through to the end). The union is
// honest about that instead of casting a KeyboardEvent to MouseEvent.
function enterEditMode(e: MouseEvent | KeyboardEvent) {
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
  // Caret-at-point is mouse-only; keyboard activation skips it.
  if ('clientX' in e) {
    if (typeof doc.caretPositionFromPoint === 'function') {
      const pos = doc.caretPositionFromPoint(e.clientX, e.clientY)
      if (pos) { clickedNode = pos.offsetNode; clickedOffset = pos.offset }
    } else if (typeof doc.caretRangeFromPoint === 'function') {
      const range = doc.caretRangeFromPoint(e.clientX, e.clientY)
      if (range) { clickedNode = range.startContainer; clickedOffset = range.startOffset }
    }
  }
  pendingCaretPos = clickedNode
    ? caretOffsetFromClick(container, clickedNode, clickedOffset)
    : null

  isEditingNote.value = true
  void nextTick(() => {
    // The field clamps the offset itself — it is the only one that knows how
    // long its own content is, and in Formatted mode the answer is a document
    // position rather than a character count.
    noteFieldRef.value?.focus(pendingCaretPos ?? undefined)
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
// The "saved ✓" pulse is a persistence RECEIPT: it fires when the write
// resolves and never on a reported failure, so a pulse on screen always
// means the row reached disk.
//
// It lives here rather than inside commitAnnotation because not every
// write is a draft commit — the exclusion chooser writes directly, and
// while the pulse was commitAnnotation's private business that chip was
// the one control on the journal that saved in silence.
function pulseWhenPersisted(field: SavedField, outcome: void | boolean | Promise<void | boolean>) {
  void Promise.resolve(outcome)
    .then((ok) => {
      if (ok === false) return
      savedFlash.value = field
      setTimeout(() => { if (savedFlash.value === field) savedFlash.value = '' }, 900)
    })
    .catch(() => { /* rejected persist — no false receipt */ })
}

// Setting or clearing the reason a match doesn't count. It carries the
// rest of the drafts like every other field write, so an in-flight note
// is never lost to a chip click.
function setExclusionReason(reason: ExclusionReason) {
  const outcome = emitAnnotation({
    leavers:     record().annotation?.leavers ?? [],
    throwers:    record().annotation?.throwers ?? [],
    note:        noteDraft.value.trim(),
    replay_code: replayDraft.value.trim(),
    members:     memberDraft.value,
    tags:        tagDraft.value,
    exclusion_reason: reason,
  })
  pulseWhenPersisted('exclusion', outcome)
  return outcome
}

function commitAnnotation(field: Exclude<SavedField, 'exclusion'>) {
  // A full-state commit persists any applied-but-unconfirmed members/tags
  // too (every field write carries all drafts), so an in-flight apply is
  // hereby confirmed implicitly.
  applyPending.value = false
  applySnapshot = null
  const outcome = emitAnnotation({
    leavers:     record().annotation?.leavers ?? [],
    throwers:    record().annotation?.throwers ?? [],
    note:        noteDraft.value.trim(),
    replay_code: replayDraft.value.trim(),
    members:     memberDraft.value,
    tags:        tagDraft.value,
    exclusion_reason: (record().annotation?.exclusion_reason ?? '') as ExclusionReason,
  })
  pulseWhenPersisted(field, outcome)
}

// ── Apply previous annotation ───────────────────────────────────
//
// One-click copy of another match's members + tags into THIS match's
// draft, replacing it — nothing persists until the user confirms (or
// implicitly confirms by committing any field, see commitAnnotation).
// Undo restores the snapshotted pre-apply draft. Note / replay code /
// leaver are deliberately never copied: they're per-match by nature.
const applyPending = ref(false)
let applySnapshot: { members: string[], tags: string[] } | null = null

function applyAnnotationDraft(src: { members?: string[], tags?: string[] }) {
  applySnapshot = { members: memberDraft.value, tags: tagDraft.value }
  memberDraft.value = [...(src.members ?? [])]
  tagDraft.value = (src.tags ?? []).map(normalizeTagLabel).filter(Boolean)
  applyPending.value = true
}

function confirmAppliedAnnotation() {
  // commitAnnotation clears the pending state itself (implicit-confirm
  // path); the Group cell carries the saved pulse for the copied set.
  commitAnnotation('members')
}

function undoAppliedAnnotation() {
  if (applySnapshot) {
    memberDraft.value = applySnapshot.members
    tagDraft.value = applySnapshot.tags
  }
  applyPending.value = false
  applySnapshot = null
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
// the last chip — standard tagify-style behavior.
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

// Arrow keys wrap around the open suggestion list; no-op when closed.
function moveTagCursor(e: KeyboardEvent, delta: number, open: boolean, len: number) {
  if (!open) return
  e.preventDefault()
  tagCursor.value = (tagCursor.value + delta + len) % len
}

// Enter/comma adopt the highlighted suggestion when one is under the
// cursor; otherwise they commit the free-typed input as a custom tag.
function commitTagKey(e: KeyboardEvent, open: boolean, sugs: string[]) {
  e.preventDefault()
  if (open && tagCursor.value >= 0 && tagCursor.value < sugs.length) {
    adoptSuggestion(sugs[tagCursor.value]!)
    return
  }
  addCustomTag()
}

function closeTagSuggestions(e: KeyboardEvent, open: boolean) {
  if (!open) return
  e.preventDefault()
  tagSuggestionsOpen.value = false
  tagCursor.value = -1
}

// Backspace in an empty input pops the most recently added tag.
function popLastTag(e: KeyboardEvent) {
  if (tagInput.value === '' && tagDraft.value.length > 0) {
    e.preventDefault()
    removeTag(tagDraft.value[tagDraft.value.length - 1]!)
  }
}

function onTagKeydown(e: KeyboardEvent) {
  const sugs = tagSuggestions.value
  const open = tagSuggestionsOpen.value && sugs.length > 0
  switch (e.key) {
    case 'ArrowDown': moveTagCursor(e, 1, open, sugs.length); return
    case 'ArrowUp':   moveTagCursor(e, -1, open, sugs.length); return
    case 'Enter':
    case ',':         commitTagKey(e, open, sugs); return
    case 'Escape':    closeTagSuggestions(e, open); return
    case 'Backspace': popLastTag(e); return
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
    setExclusionReason,
    hasAnyNote,
    isEditingNote,
    noteFieldRef,
    noteHighlightTerms,
    noteHasHits,
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
  }
}
