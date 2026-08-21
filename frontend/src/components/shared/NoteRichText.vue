<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'

import { markdownOf, noteExtensions } from '@/components/shared/note-tiptap'
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
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:text': [text: string]
  blur: []
}>()

// What we last sent up. The autosave echo returns this exact string, and
// recognising it is what stops the round trip from touching the document.
let lastEmitted = props.text

const editor = useEditor({
  content: textToDoc(props.text),
  editable: !props.disabled,
  extensions: noteExtensions(props.placeholder),
  editorProps: {
    attributes: {
      // contenteditable maps to a textbox implicitly, but the accessible NAME
      // has to be given — without it the field is unlabelled to a screen
      // reader and unfindable by getByRole(name).
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': props.label,
      class: 'note-prose note-rich',
      'data-note-surface': 'rich',
    },
  },
  onUpdate: ({ editor: e }) => {
    lastEmitted = markdownOf(e.state.doc)
    emit('update:text', lastEmitted)
  },
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

watch(() => props.disabled, (off) => editor.value?.setEditable(!off))

defineExpose({
  focus: () => editor.value?.commands.focus(),
  /** Whether a mark is live at the cursor — the toolbar's pressed state. */
  isActive: (name: string) => editor.value?.isActive(name) ?? false,
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

.note-rich-host :deep(.note-rich:focus-visible) {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
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
