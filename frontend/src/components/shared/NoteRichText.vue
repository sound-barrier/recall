<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import type { Editor as EditorLike } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { EditorContent, useEditor } from '@tiptap/vue-3'

import {
  markdownOf, noteExtensions, searchHitsKey, TOOL_STATE,
} from '@/components/shared/note-tiptap'
import { textToDoc } from '@/match/markdown/note-doc'

// The TipTap host, and the only file in the app that imports @tiptap.
//
// It is loaded through defineAsyncComponent from NoteWriter, so ProseMirror
// lands in its own chunk behind the two lazy views that use it and never
// reaches the initial bundle. App.lazy-views.test.ts pins that.
//
// The editor is CONTROLLED — the note's text comes back down as a prop — and
// for a document model that is a real hazard rather than a convention: calling
// setContent on every echo would re-parse the document, drop the cursor and
// clear the undo stack, 400 ms after every keystroke. The watcher below is
// what makes it safe.

const props = defineProps<{
  text: string
  /** Announced as the field's name; the e2e and unit suites query by it. */
  label: string
  placeholder: string
  /** An id for the editable element, for callers that must point at it. */
  fieldId?: string
  disabled?: boolean
  /** Search terms to light. Drawn over the text; never part of the note. */
  highlight?: readonly string[]
}>()

const emit = defineEmits<{
  'update:text': [text: string]
  focus: []
  /**
   * Which tools are live at the cursor. PUSHED rather than pulled: a parent
   * calling editor.isActive() during render gets an answer Vue has no reason
   * to re-evaluate, so the toolbar would light up once and then lie.
   */
  'update:active': [active: Record<string, boolean>]
  blur: []
}>()

let lastActive = ''

function publishActive(e: EditorLike): void {
  const active: Record<string, boolean> = {}
  for (const t of TOOL_STATE) active[t.key] = e.isActive(t.name, t.attrs)
  // Only on a real change: onTransaction fires for every keystroke and every
  // cursor move, and re-rendering the toolbar on each would be wasteful.
  const signature = JSON.stringify(active)
  if (signature === lastActive) return
  lastActive = signature
  emit('update:active', active)
}

/**
 * The ARIA a textbox owes a reader, spelled out.
 *
 * A contenteditable maps to a textbox implicitly, but three things do not come
 * for free. The NAME has to be given or the field is unlabeled to a screen
 * reader and unfindable by getByRole(name). `aria-readonly` is how a refusal
 * is announced — a disabled contenteditable is not "disabled" to anything, and
 * `toBeEnabled` passes VACUOUSLY on one, so without this an assertion about a
 * blocked field silently means nothing. And `aria-placeholder` names the hint
 * the Placeholder extension paints in a ::before, which no reader and no
 * matcher can see.
 */
function fieldAttributes(): Record<string, string> {
  return {
    ...(props.fieldId ? { id: props.fieldId } : {}),
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-label': props.label,
    'aria-placeholder': props.placeholder,
    'aria-readonly': props.disabled ? 'true' : 'false',
    class: 'note-prose note-rich',
    'data-note-surface': 'rich',
  }
}

// What we last sent up. The autosave echo returns this exact string, and
// recognizing it is what stops the round trip from touching the document.
let lastEmitted = props.text

const editor = useEditor({
  content: textToDoc(props.text),
  editable: !props.disabled,
  extensions: noteExtensions(props.placeholder),
  editorProps: { attributes: fieldAttributes() },
  // onTransaction rather than onSelectionUpdate: pressing Bold with nothing
  // selected sets a STORED mark, which changes neither the document nor the
  // selection — so the toolbar would stay dark while the next character came
  // out bold.
  onCreate: ({ editor: e }) => {
    publishActive(e)
    // Seed the terms here, not only from the watcher: `useEditor` builds the
    // editor on MOUNT, so the immediate watch below runs while the ref is still
    // undefined and drops its dispatch. A search armed before the note opened
    // would then never light, and nothing would ever fire again — the terms do
    // not change just because a different note was opened.
    sendHighlight(e)
  },
  onTransaction: ({ editor: e }) => publishActive(e),
  onUpdate: ({ editor: e }) => {
    lastEmitted = markdownOf(e.state.doc)
    emit('update:text', lastEmitted)
  },
  onFocus: () => emit('focus'),
  onBlur: () => emit('blur'),
})

watch(() => props.text, (next) => {
  const e = editor.value
  if (!e) return
  // Our own echo, returning unchanged.
  if (next === lastEmitted) return
  // Never rebuild the document mid-composition: an IME's in-flight text is
  // held in the view, not the document, and setContent would swallow it.
  if (e.view.composing) return
  // Belt and braces — a different string that means the same document (the
  // cosmetic normalizations) must not cost the cursor either.
  if (next === markdownOf(e.state.doc)) return
  // emitUpdate false: loading a note is not an edit, so opening one and
  // leaving never rewrites it. Normalization lands on a real keystroke.
  e.commands.setContent(textToDoc(next), { emitUpdate: false })
  lastEmitted = next
})

function sendHighlight(e: EditorLike): void {
  e.view.dispatch(e.state.tr.setMeta(searchHitsKey, [...(props.highlight ?? [])]))
}

watch(() => props.highlight, () => {
  const e = editor.value
  if (e) sendHighlight(e)
}, { deep: true })

watch(() => props.disabled, (off) => {
  const e = editor.value
  if (!e) return
  e.setEditable(!off)
  // setOptions, not a template binding: these live on ProseMirror's own
  // editable node, which Vue does not render.
  e.setOptions({ editorProps: { attributes: fieldAttributes() } })
})

/**
 * Where a plain-text offset lands in the document.
 *
 * A caret-at-click gives an offset into the TEXT a reader sees, and a document
 * position counts node boundaries too, so the two diverge the moment a note
 * has more than one block. Walking the text nodes converts one to the other.
 */
function posOfTextOffset(doc: PMNode, offset: number): number {
  let seen = 0
  let found: number | null = null
  doc.descendants((node, pos) => {
    if (found !== null) return false
    if (!node.isText) return true
    const len = node.text?.length ?? 0
    if (seen + len >= offset) {
      found = pos + (offset - seen)
      return false
    }
    seen += len
    return true
  })
  return found ?? doc.content.size
}

defineExpose({
  focus: (offset?: number) => {
    const e = editor.value
    if (!e) return
    // 'end', not the editor's remembered selection: no offset is a request to
    // keep writing, which starts after what is already there.
    if (offset === undefined) e.commands.focus('end')
    else e.commands.focus(posOfTextOffset(e.state.doc, offset))
  },
  chain: () => editor.value?.chain().focus(),
})

onBeforeUnmount(() => editor.value?.destroy())
</script>

<template>
  <EditorContent :editor="editor" class="note-rich-host" />
</template>

<style scoped>
/* The editor's own chrome only. Everything that decides how the PROSE looks
   lives in styles/note-prose.css, shared with NoteProse — the read surface and
   the writing surface paint from one sheet by construction, so they cannot
   drift into looking different. */
.note-rich-host :deep(.note-rich) {
  min-height: 6.5rem;
  padding: 0.5rem 0.6rem;
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-md);
  outline: none;
}

/* --accent-text, not --accent: `.paper` remaps the former to --paper-accent
   and leaves the latter alone, so --accent reads wrong inside the film room. */
.note-rich-host :deep(.note-rich:focus-visible) {
  border-color: var(--accent-text);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-text) 30%, transparent);
}

/* The placeholder the Placeholder extension paints on the first empty block. */
.note-rich-host :deep(.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
  color: var(--text-faint);
}
</style>
