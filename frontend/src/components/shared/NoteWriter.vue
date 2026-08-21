<script setup lang="ts">
import { computed, defineAsyncComponent, ref, useTemplateRef, nextTick } from 'vue'

import { applyInlineMark, applyLineMark, type InlineMark, type LineMark } from '@/match/markdown/note-toolbar'
import { MAX_NOTE_TEXT } from '@/match/markdown/note-doc'

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

const props = defineProps<{
  text: string
  /** The field's accessible name. */
  label: string
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
}>()

const emit = defineEmits<{
  'update:text': [text: string]
  blur: []
}>()

type Mode = 'rich' | 'raw'
// Local, and deliberately not persisted: the choice belongs to the note you
// are looking at, not to the app.
const mode = ref<Mode>('rich')

const rich = useTemplateRef<InstanceType<typeof NoteRichText>>('rich')
const rawField = useTemplateRef<HTMLTextAreaElement>('rawField')

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
  if (next.text.length > MAX_NOTE_TEXT) return
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

defineExpose({ focus: () => (mode.value === 'rich' ? rich.value?.focus() : rawField.value?.focus()) })
</script>

<template>
  <div class="note-writer">
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
    </div>

    <NoteRichText
      v-if="mode === 'rich'"
      ref="rich"
      :text="text"
      :label="label"
      :placeholder="placeholder"
      :disabled="disabled"
      @update:text="emit('update:text', $event)"
      @update:active="active = $event"
      @blur="emit('blur')"
    />
    <textarea
      v-else
      ref="rawField"
      class="note-raw note-text"
      rows="5"
      :value="text"
      :aria-label="label"
      :maxlength="MAX_NOTE_TEXT"
      :disabled="disabled"
      :title="blockedReason"
      :placeholder="placeholder"
      spellcheck="true"
      autocorrect="off"
      data-note-surface="raw"
      @input="onRawInput"
      @keydown="onRawKeydown"
      @blur="emit('blur')"
    />
  </div>
</template>

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
  border-radius: var(--radius-sm);
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
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}

.note-mode-btn:last-child {
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
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
