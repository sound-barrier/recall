<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'

import NoteProse from '@/components/shared/NoteProse.vue'
import { pluralize } from '@/match/match-label-helpers'
import { useModalFocusTrap } from '@/composables/shared/keyboard/useModalFocusTrap'
import { useUiStore } from '@/stores/ui'

import { applyInlineMark, applyLineMark, type InlineMark, type LineMark } from '@/match/markdown/note-toolbar'
import { MAX_NOTE_TEXT, wordCount } from '@/match/markdown/note-doc'

// The note WRITING surface, for both editors that have one.
//
// Two modes over one value. Formatted is a real WYSIWYG — you type `**x**` and
// see bold — and Markdown is the plain textarea, showing the text exactly as
// it is stored. The toggle is a peek at the source, not a setting: it resets
// to Formatted on every mount, because the default the user asked for should
// be the one they land on.
//
// The toolbar serves both modes, but by different means. In Formatted it runs
// the editor's own commands and can therefore show PRESSED state, which a
// textarea never could — the fix for a real problem, since Title and
// Subheading paint identically on every surface (the ledger styles h3 and h4
// the same) and pressed state is the only thing that tells them apart. In
// Markdown it runs note-toolbar.ts's pure text transforms, unchanged.

const NoteRichText = defineAsyncComponent(() => import('@/components/shared/NoteRichText.vue'))

// A Teleport cannot receive fallthrough attributes, and this component's root
// became one. Bind them explicitly to the writer's own element so a host that
// passes a class still gets it.
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  text: string
  /** The field's accessible name. */
  label: string
  /** An id for the field itself, when a caller needs to point at it. */
  fieldId?: string
  placeholder: string
  disabled?: boolean
  /**
   * The toolbar alone, off. A note marked reviewed-only has nothing to
   * format, but its text stays writable — so this is a separate condition
   * from `disabled`, not a synonym for it.
   */
  toolsDisabled?: boolean
  /** Why the TOOLS are off — a reason for the toolbar buttons only. */
  disabledReason?: string
  /**
   * Why the FIELD is off. Separate from disabledReason on purpose: a note
   * marked reviewed-only has its tools off and its text still writable, and
   * titling the writable field "Reviewed is on — turn it off to write" is a
   * sentence about a control the reader is not touching.
   */
  blockedReason?: string
  /** Paper surface (the film room) vs the ordinary card surface (a journal). */
  surface?: 'paper' | 'plain'
  /**
   * Search terms to light while writing. Formatted draws them as decorations
   * over the text; Markdown mode shows the source, where a hit would have to
   * be markup a textarea cannot hold, so it shows none.
   */
  highlight?: readonly string[]
  /**
   * Offer the full-viewport writing surface. Opt-in, because it only earns
   * its place where someone might write at length — a journal note or a
   * coach's note, not the two-line field in a form that is mostly pickers.
   */
  expandable?: boolean
  /**
   * The cap this field's own server accepts, when it is not the note cap.
   * The send-to-coach message is 2000 runes (bundle.maxPlayerMessageRunes);
   * refusing the 2001st keystroke here is what keeps that refusal from
   * arriving later, at Send, detached from the sentence that caused it.
   */
  maxLength?: number
}>()

const maxChars = computed(() => props.maxLength ?? MAX_NOTE_TEXT)

const emit = defineEmits<{
  'update:text': [text: string]
  focus: []
  blur: []
  /**
   * Collapsing the expanded surface. NOT a blur: the writer is still open and
   * still being edited, it is merely back inline — so a host that saves on
   * blur has to be told to save here too, or a full-screen writing session
   * would end with nothing written down.
   */
  commit: []
}>()

type Mode = 'rich' | 'raw'
// Local, and deliberately not persisted: the choice belongs to the note you
// are looking at, not to the app.
const mode = ref<Mode>('rich')

const root = useTemplateRef<HTMLElement>('root')
const rich = useTemplateRef<InstanceType<typeof NoteRichText>>('rich')
const rawField = useTemplateRef<HTMLTextAreaElement>('rawField')

/**
 * Blur means focus left the WRITER, not the field.
 *
 * The journal treats a blur as "done editing" and swaps the whole writer back
 * to a read-only preview — so forwarding the field's own blur would make the
 * editor vanish the moment you reached for Bold. The field is one control among
 * several here; the toolbar and the mode toggle are the writer's own chrome, and
 * moving between them is not leaving.
 *
 * Deferred rather than read from `relatedTarget`: a mousedown on a button does
 * not focus it in every browser, so relatedTarget can be null while focus is
 * about to come straight back — which the toolbar handlers do explicitly.
 * Asking after the dust settles is the answer that holds everywhere.
 */
function onFocusOut(): void {
  setTimeout(() => {
    // An EXPANDED writer is a modal, and a modal is not left by a blur. The
    // teleport to <body> moves focus on its way out, so forwarding that would
    // tell the journal "done editing" and unmount the writer out from under
    // the surface that had just opened — which is exactly what it did.
    if (expanded.value) return
    if (root.value?.contains(document.activeElement)) return
    emit('blur')
  }, 0)
}

// ── the expanded writing surface ─────────────────────────────────────────
//
// Not a second editor: <Teleport :disabled> MOVES this component's own DOM to
// <body> and back, so the value, the mode, the toolbar state and the live
// ProseMirror instance all survive the trip. There is nothing to hand over,
// which is why there is no state to lose.
//
// It stacks over hosts that are themselves modals (the detail panel, the film
// room), so the flag lives in the UI store: the host has to be made inert, and
// this surface is no longer a descendant of it once teleported.
const uiStore = useUiStore()
const expanded = ref(false)

const words = computed(() => pluralize(wordCount(props.text), 'word'))

/**
 * Escape closes the writer and NOTHING else.
 *
 * Capture phase, and stopImmediatePropagation, for the same reason the
 * screenshot lightbox does it: the host underneath registers its own
 * bubble-phase Escape, and without this ordering one press would close both.
 */
function onExpandedKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  e.preventDefault()
  e.stopImmediatePropagation()
  expanded.value = false
}

// Tab containment and the page-scroll freeze, from the shared trap. `inert`
// on the hosts is NOT enough: this teleports to <body>, and the overlay layer
// and the toasts live outside the container that gets inerted — so without
// containment Tab walks onto controls this surface is painting over, and
// Enter on one of them navigates the app out from under a half-written note.
//
// Its own Escape never fires: the capture-phase handler above stops the event
// before it reaches the trap's bubble-phase listener, which is what keeps one
// press from closing this AND the panel underneath.
useModalFocusTrap(expanded, {
  containerSelector: '.note-writer-expanded',
  onClose: () => { expanded.value = false },
  // The markup-first focusable is a formatting button. Someone who expanded a
  // writer means to write.
  initialFocus: () => focusField(),
  // Not back to Expand — that control reopens what was just closed.
  restoreFocus: false,
})

watch(expanded, async (open) => {
  uiStore.expandedWriterOpen = open
  if (open) {
    document.addEventListener('keydown', onExpandedKeydown, true)
    return
  }
  document.removeEventListener('keydown', onExpandedKeydown, true)
  emit('commit')
  // Focus returns to the FIELD, not to the Expand button that opened this.
  //
  // The dialog convention says restore to the trigger, but the trigger here
  // reopens the thing just closed — so a Space or Enter from someone who was
  // mid-sentence would expand it straight back. They were writing; put them
  // back in the writing. It also settles a race: Teleport moving the editor
  // home lets ProseMirror reclaim focus, which fought a restore aimed
  // anywhere else.
  await nextTick()
  focusField()
}, { flush: 'post' })

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onExpandedKeydown, true)
  if (expanded.value) uiStore.expandedWriterOpen = false
})

const chipClass = computed(() => (props.surface === 'plain' ? 'note-tool-plain' : 'paper-chip'))

// The `mark` doubles as the key the editor reports state under (TOOL_STATE in
// note-tiptap.ts), so a tool cannot be added to one and forgotten in the other.
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

// Pushed up by the editor on create, selection and change. A plain
// isActive() call during render would be answered once and never re-run, so
// the toolbar would light up on mount and then quietly stop telling the truth.
const active = ref<Record<string, boolean>>({})

/** Whether a tool is live at the cursor. Only Formatted can answer. */
function isActive(mark: string): boolean {
  return mode.value === 'rich' && (active.value[mark] ?? false)
}

// ── raw mode: the pure text transforms, exactly as before ────────────────

function applyRawEdit(next: { text: string; start: number; end: number }): void {
  if (next.text.length > maxChars.value) return
  emit('update:text', next.text)
  void nextTick(() => {
    const field = rawField.value
    if (!field) return
    field.focus()
    field.setSelectionRange(next.start, next.end)
  })
}

function onRawInput(e: Event): void {
  if (!(e.target instanceof HTMLTextAreaElement)) return
  emit('update:text', e.target.value)
}

// ── the toolbar, over whichever mode is showing ──────────────────────────

type Chain = NonNullable<ReturnType<NonNullable<typeof rich.value>['chain']>>

const RICH_INLINE: Record<InlineMark, (c: Chain) => void> = {
  bold: (c) => void c.toggleBold().run(),
  italic: (c) => void c.toggleItalic().run(),
  strike: (c) => void c.toggleStrike().run(),
}

const RICH_LINE: Record<LineMark, (c: Chain) => void> = {
  title: (c) => void c.toggleHeading({ level: 1 }).run(),
  subtitle: (c) => void c.toggleHeading({ level: 2 }).run(),
  bullet: (c) => void c.toggleBulletList().run(),
  number: (c) => void c.toggleOrderedList().run(),
}

function markInline(mark: InlineMark): void {
  if (props.toolsDisabled) return
  if (mode.value === 'rich') {
    const c = rich.value?.chain()
    if (c) RICH_INLINE[mark](c)
    return
  }
  const field = rawField.value
  if (!field) return
  applyRawEdit(applyInlineMark(props.text, field.selectionStart, field.selectionEnd, mark))
}

function markLine(mark: LineMark): void {
  if (props.toolsDisabled) return
  if (mode.value === 'rich') {
    const c = rich.value?.chain()
    if (c) RICH_LINE[mark](c)
    return
  }
  const field = rawField.value
  if (!field) return
  applyRawEdit(applyLineMark(props.text, field.selectionStart, field.selectionEnd, mark))
}

/** ⌘/Ctrl+B and +I, the two every text field on every platform answers. */
function onRawKeydown(e: KeyboardEvent): void {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || props.toolsDisabled) return
  const key = e.key.toLowerCase()
  if (key !== 'b' && key !== 'i') return
  e.preventDefault()
  markInline(key === 'b' ? 'bold' : 'italic')
}

/**
 * A focus asked for before the editor existed.
 *
 * The rich field is behind a dynamic import, so on a first open the chunk may
 * still be in flight when someone clicks the note — and a focus dropped on the
 * floor there is not a test artifact, it is a user clicking their note and
 * typing into nothing. Held and applied the moment the editor arrives.
 */
let pendingFocus: number | null | undefined
watch(rich, (r) => {
  if (!r || pendingFocus === undefined) return
  r.focus(pendingFocus ?? undefined)
  pendingFocus = undefined
})

/**
 * Focus the field, optionally at a plain-text offset — the currency a
 * caret-at-click produces. Formatted maps it to a document position;
 * Markdown mode is already counting characters, so it uses it directly.
 *
 * A named function rather than an inline one on defineExpose, because the
 * expand/collapse watcher needs it too — and a bare `focus()` in this scope
 * silently resolves to window.focus, which type-checks and does nothing to
 * the field.
 */
function focusField(offset?: number): void {
  if (mode.value === 'rich') {
    if (rich.value) rich.value.focus(offset)
    else pendingFocus = offset ?? null
    return
  }
  const field = rawField.value
  if (!field) return
  field.focus()
  // No offset means the END — "Edit annotation" from the row menu is a
  // request to keep writing, and a caret parked at character zero would put
  // the next sentence in front of the last one.
  const at = offset === undefined
    ? field.value.length
    : Math.max(0, Math.min(offset, field.value.length))
  field.setSelectionRange(at, at)
}

defineExpose({ focus: focusField })
</script>

<template>
  <!-- :disabled keeps the writer exactly where it is until it is expanded;
       when it is, the SAME nodes move to <body> rather than a second copy
       mounting beside them. -->
  <Teleport to="body" :disabled="!expanded">
    <div
      ref="root"
      v-bind="$attrs"
      class="note-writer"
      :class="{ 'note-writer-expanded': expanded, paper: expanded && surface === 'paper' }"
      :role="expanded ? 'dialog' : undefined"
      :aria-modal="expanded ? 'true' : undefined"
      :aria-label="expanded ? label : undefined"
      @focusout="onFocusOut"
    >
      <div class="note-writer-tools">
        <div class="note-toolbar" role="toolbar" aria-label="Formatting">
          <button
            v-for="b in TOOLBAR_INLINE"
            :key="b.mark"
            type="button"
            class="note-tool"
            :class="[chipClass, { 'note-tool-em': b.mark === 'italic', 'note-tool-del': b.mark === 'strike' }]"
            :aria-label="b.label"
            :aria-pressed="isActive(b.mark)"
            :disabled="toolsDisabled"
            :title="disabledReason ?? b.label"
            @click="markInline(b.mark)"
          >
            {{ b.glyph }}
          </button>
          <span class="note-tool-sep" aria-hidden="true" />
          <button
            v-for="b in TOOLBAR_LINE"
            :key="b.mark"
            type="button"
            class="note-tool"
            :class="chipClass"
            :aria-label="b.label"
            :aria-pressed="isActive(b.mark)"
            :disabled="toolsDisabled"
            :title="disabledReason ?? b.label"
            @click="markLine(b.mark)"
          >
            {{ b.glyph }}
          </button>
        </div>

        <!-- role="group", not a tablist: the app has exactly one tablist and it
           belongs to the seven views. Every other two-state picker here is a
           pressed pair. -->
        <div class="note-mode" role="group" aria-label="Note format">
          <button
            type="button"
            class="note-mode-btn"
            :class="{ 'note-mode-on': mode === 'rich' }"
            :aria-pressed="mode === 'rich'"
            data-note-mode-pick="rich"
            @click="mode = 'rich'"
          >
            Formatted
          </button>
          <button
            type="button"
            class="note-mode-btn"
            :class="{ 'note-mode-on': mode === 'raw' }"
            :aria-pressed="mode === 'raw'"
            data-note-mode-pick="raw"
            @click="mode = 'raw'"
          >
            Markdown
          </button>
        </div>

        <button
          v-if="expandable && !expanded"
          type="button"
          class="note-expand"
          :class="chipClass"
          :aria-label="`Expand ${label}`"
          @click="expanded = true"
        >
          Expand
        </button>
      </div>

      <div class="note-writer-body">
        <NoteRichText
          v-if="mode === 'rich'"
          ref="rich"
          :text="text"
          :label="label"
          :field-id="fieldId"
          :placeholder="placeholder"
          :disabled="disabled"
          :highlight="highlight"
          @update:text="emit('update:text', $event)"
          @update:active="active = $event"
          @focus="emit('focus')"
        />
        <textarea
          v-else
          :id="fieldId"
          ref="rawField"
          class="note-raw note-text"
          rows="5"
          :value="text"
          :aria-label="label"
          :maxlength="maxChars"
          :disabled="disabled"
          :title="blockedReason"
          :placeholder="placeholder"
          spellcheck="true"
          autocorrect="off"
          data-note-surface="raw"
          @input="onRawInput"
          @keydown="onRawKeydown"
          @focus="emit('focus')"
        />

        <!-- Only in Markdown mode: Formatted IS the preview, and a second pane
           showing the same thing would be two views of one surface. -->
        <section v-if="expanded && mode === 'raw'" class="note-preview-pane" aria-label="Preview">
          <NoteProse :text="text" />
        </section>
      </div>

      <div v-if="expanded" class="note-writer-foot">
        <span class="note-words">{{ words }}</span>
        <button type="button" class="note-done" :class="chipClass" @click="expanded = false">
          Done
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped src="./note-writer-expanded.css"></style>

<style scoped>
.note-writer-tools {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  justify-content: space-between;
  margin: 0 0 0.4rem;
}

.note-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  align-items: center;
}

.note-tool {
  min-width: 1.9rem;
  font-family: var(--mono);
  font-size: var(--type-2xs);
  cursor: pointer;
}

/* --accent-text travels: `.paper` remaps it to --paper-accent, and off paper
   it is the legible accent. --accent is remapped by neither. */
.note-tool[aria-pressed='true'] {
  border-color: var(--accent-text);
  box-shadow: inset 0 0 0 1px var(--accent-text);
}

.note-tool-em { font-style: italic; }
.note-tool-del { text-decoration: line-through; }

.note-tool-sep {
  width: 1px;
  height: 1rem;
  margin: 0 0.15rem;
  background: var(--hairline);
}

/* The plain surface (a match journal) has no paper tokens to borrow. */
.note-tool-plain {
  padding: 0.15rem 0.4rem;
  color: var(--text-dim);
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
}

.note-tool-plain[aria-pressed='true'] {
  color: var(--text);
  border-color: var(--accent-text);
  box-shadow: inset 0 0 0 1px var(--accent-text);
}

.note-mode {
  display: flex;
  flex: 0 0 auto;
}

.note-mode-btn {
  padding: 0.15rem 0.5rem;
  font-family: var(--mono);
  font-size: var(--type-3xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-dim);
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--hairline);
}

.note-mode-btn + .note-mode-btn {
  border-left: none;
}

.note-mode-btn:first-child {
  border-radius: var(--radius) 0 0 var(--radius);
}

.note-mode-btn:last-child {
  border-radius: 0 var(--radius) var(--radius) 0;
}

.note-mode-on {
  color: var(--text);
  background: var(--surface-3);
}

.note-raw {
  width: 100%;
  min-height: 6.5rem;
  padding: 0.5rem 0.6rem;
  font: inherit;
  color: inherit;
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-md);
  resize: vertical;
}
</style>
