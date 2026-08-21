/**
 * The editor's schema — the note grammar, and nothing else.
 *
 * Every node and mark here has a counterpart in note-blocks.ts, and nothing
 * here has one that does not. That is not tidiness: a schema is what a paste
 * is filtered through, so a node absent from this list cannot enter the
 * document by ANY route. It is why there is no starter-kit — starter-kit is
 * links, tables, code blocks, blockquotes, rules and nested lists, which is
 * precisely the grammar the ledger cannot render.
 *
 * Four plugins enforce the rules a schema cannot express. Three of them exist
 * because the grammar has no escape syntax, so a document the serializer
 * cannot spell must be prevented rather than repaired.
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'

import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import HardBreak from '@tiptap/extension-hard-break'
import Heading from '@tiptap/extension-heading'
import Bold from '@tiptap/extension-bold'
import Italic from '@tiptap/extension-italic'
import Strike from '@tiptap/extension-strike'
import { BulletList, ListItem, OrderedList } from '@tiptap/extension-list'
import { Placeholder, UndoRedo } from '@tiptap/extensions'

import { SPACE, topHeadingLevel, type Block } from '@/match/markdown/note-blocks'
import { docToMarkdown, textToDoc, MAX_NOTE_TEXT, type NoteDoc } from '@/match/markdown/note-doc'

/** A doc as our plain-JSON shape. PM's toJSON is structurally the same. */
function asNoteDoc(doc: PMNode): NoteDoc {
  return doc.toJSON() as NoteDoc
}

export function markdownOf(doc: PMNode): string {
  return docToMarkdown(asNoteDoc(doc))
}

/**
 * Headings carry BOTH levels: what the author wrote and which tag to paint.
 *
 * `level` is the authored one and the serializer's only input. `displayLevel`
 * mirrors renderMarkdown's normalization, so the editor shows the same h3/h4
 * the exported ledger shows — and so a note whose only heading is a `##` does
 * not paint a lone h4 under the card's h2, which is a level skip axe reports.
 *
 * Neither is rendered as an attribute: the tag vocabulary is shared with the
 * Go ledger and is deliberately attribute-free but for `<ol start>`.
 */
const NoteHeading = Heading.extend({
  addOptions() {
    return { HTMLAttributes: {}, ...this.parent?.(), levels: [1, 2] as (1 | 2)[] }
  },
  addAttributes() {
    return {
      level: { default: 1, rendered: false },
      displayLevel: { default: 3, rendered: false },
    }
  },
  parseHTML() {
    return [{ tag: 'h3', attrs: { level: 1, displayLevel: 3 } },
      { tag: 'h4', attrs: { level: 2, displayLevel: 4 } }]
  },
  renderHTML({ node }) {
    const display = node.attrs.displayLevel === 4 ? 4 : 3
    return [`h${display}`, {}, 0]
  },
})

/**
 * The grammar's strikethrough tag is `<del>`; TipTap's default is `<s>`. Both
 * paint the same line, but the editor is asserted to produce the ledger's
 * markup exactly, and `<s>` is not it.
 */
const NoteStrike = Strike.extend({
  parseHTML() {
    return [{ tag: 'del' }, { tag: 's' }, { tag: 'strike' }]
  },
  renderHTML() {
    return ['del', {}, 0]
  },
})

/**
 * A list item holds ONE paragraph. No nesting, because the grammar has none —
 * `  - deep` is a sibling bullet to renderMarkdown, and a document that nested
 * would serialize to something that reads back flat.
 *
 * The paragraph is not decorative and must not be optimized away. `inline*`
 * looks tempting, because it would emit `<li>text` exactly as the ledger does
 * instead of `<li><p>text</p>` — but prosemirror-schema-list's commands split
 * and toggle a BLOCK inside the item, so with inline content splitListItem and
 * toggleBulletList both return false: Enter stops making a new bullet and the
 * toolbar's list buttons stop working. Measured, not assumed.
 *
 * The wrapper is invisible either way — note-prose.css trims a list item's
 * paragraph margins on both surfaces — so the cost is one documented
 * normalization in the DOM-equality test and nothing a reader can see.
 *
 * Tab is unbound. The list extension binds it to sink/lift by default, and a
 * contenteditable that swallows Tab is a WCAG 2.1.2 keyboard trap — one axe
 * cannot see, in a field that is the whole point of two views.
 */
const NoteListItem = ListItem.extend({
  content: 'paragraph',
  addKeyboardShortcuts() {
    // Drop Tab and Shift-Tab, KEEP everything else. Returning `{}` here is the
    // obvious-looking move and it is wrong: the parent also binds Enter to
    // splitListItem, so an empty map takes Enter with it and a list can never
    // grow a second item. Found by pressing Enter in a browser — a unit test
    // calling commands.splitListItem() directly still passed.
    const { Tab: _tab, 'Shift-Tab': _shiftTab, ...rest } = this.parent?.() ?? {}
    return rest
  },
})

/** A soft break belongs in a paragraph only; the grammar has no other place. */
const NoteHardBreak = HardBreak.extend({
  addKeyboardShortcuts() {
    return {
      'Shift-Enter': () => {
        const { $from } = this.editor.state.selection
        if ($from.parent.type.name !== 'paragraph') return false
        if ($from.node(-1)?.type.name === 'listItem') return false
        return this.editor.commands.setHardBreak()
      },
    }
  },
})

const displayLevelKey = new PluginKey('noteHeadingDisplayLevel')

/**
 * Keep every heading's painted level in step with the note around it.
 *
 * renderMarkdown decides a note's top heading from the whole note, so adding a
 * `#` above an existing `##` re-paints that `##` from h3 to h4. The document
 * has to do the same or the editor stops matching the ledger mid-edit.
 */
const HeadingDisplayLevel = Extension.create({
  name: 'noteHeadingDisplayLevel',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: displayLevelKey,
      appendTransaction: (trs, _old, state) => {
        if (!trs.some((t) => t.docChanged)) return null
        const blocks: Block[] = []
        state.doc.descendants((node) => {
          if (node.type.name === 'heading') {
            blocks.push({ kind: 'h', level: node.attrs.level as 1 | 2, text: '' })
          }
        })
        if (blocks.length === 0) return null
        const top = topHeadingLevel(blocks)
        const tr = state.tr
        let changed = false
        state.doc.descendants((node, pos) => {
          if (node.type.name !== 'heading') return
          const want = 3 + (node.attrs.level as number) - top
          if (node.attrs.displayLevel === want) return
          tr.setNodeAttribute(pos, 'displayLevel', want)
          changed = true
        })
        return changed ? tr : null
      },
    })]
  },
})

// The characters a mark may not sit on: the grammar's spaces, plus the marker
// characters themselves. `**hold **` is not bold — it renders as ITALIC with
// literal asterisks — and `**a***` reads back as bold-a plus a stray star.
const HUG_EDGE = SPACE + '*~'

function edgeRun(text: string, from: 'start' | 'end'): number {
  let n = 0
  while (n < text.length) {
    const ch = from === 'start' ? text[n] : text[text.length - 1 - n]
    if (!HUG_EDGE.includes(ch!)) break
    n += 1
  }
  return n
}

/**
 * Marks hug their content — enforced on the document, not just known by the
 * parser.
 *
 * A browser's double-click selection includes the trailing space, so selecting
 * a word and pressing Bold produces `**hold **`, which the grammar reads as
 * italic-with-asterisks rather than bold. The grammar has no escape syntax, so
 * there is no way to write that intent down; the only honest fix is to keep
 * the document out of the state entirely. The mark shrinks off the space, and
 * the user sees the emphasis land on the word.
 */
const MarksHugTheirContent = Extension.create({
  name: 'noteMarksHugTheirContent',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('noteMarksHugTheirContent'),
      appendTransaction: (trs, _old, state) => {
        if (!trs.some((t) => t.docChanged)) return null
        const tr = state.tr
        let changed = false
        state.doc.descendants((node, pos) => {
          if (!node.isText || node.marks.length === 0) return
          const text = node.text ?? ''
          const lead = edgeRun(text, 'start')
          const trail = lead === text.length ? 0 : edgeRun(text, 'end')
          for (const mark of node.marks) {
            if (lead > 0) tr.removeMark(pos, pos + lead, mark)
            if (trail > 0) tr.removeMark(pos + text.length - trail, pos + text.length, mark)
          }
          if (lead > 0 || trail > 0) changed = true
        })
        return changed ? tr : null
      },
    })]
  },
})

/**
 * The cap is on the SERIALIZED markdown, because that is what the server
 * counts (pkg/coach/note.go, in runes). A contenteditable has no `maxlength`,
 * so the refusal happens here — and a transaction that shortens the note
 * always passes, or a note already over the cap could never be repaired.
 */
const NoteLengthCap = Extension.create({
  name: 'noteLengthCap',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('noteLengthCap'),
      filterTransaction: (tr, state) => {
        if (!tr.docChanged) return true
        const next = [...markdownOf(tr.doc)].length
        if (next <= MAX_NOTE_TEXT) return true
        return next <= [...markdownOf(state.doc)].length
      },
    })]
  },
})

/**
 * Paste is plain text, parsed by our grammar.
 *
 * Never `text/html`: the schema would filter it, but what survives is whatever
 * the source site's markup happened to map to, which is not what the pasted
 * CHARACTERS say. Running the text through the note parser instead means
 * pasting `# Title` produces a heading — right for a WYSIWYG — and, more
 * quietly, that a paragraph can never begin with a line marker and get
 * promoted to a heading the next time the note is opened.
 */
const PlainTextOnly = Extension.create({
  name: 'notePlainTextOnly',
  addProseMirrorPlugins() {
    const insert = (text: string): boolean => {
      if (text === '') return false
      const doc = textToDoc(text)
      const only = doc.content.length === 1 ? doc.content[0] : undefined
      // A paste with no block structure of its own joins the line it lands on.
      const content = only?.type === 'paragraph' ? (only.content ?? []) : doc.content
      this.editor.commands.insertContent(content)
      return true
    }
    return [new Plugin({
      key: new PluginKey('notePlainTextOnly'),
      props: {
        handlePaste: (_view, event) => insert(event.clipboardData?.getData('text/plain') ?? ''),
        handleDrop: (_view, event) => {
          const dt = (event as DragEvent).dataTransfer
          return insert(dt?.getData('text/plain') ?? '')
        },
      },
    })]
  },
})

/**
 * The tools whose pressed state the editor reports, and how to ask about each.
 *
 * One list so the toolbar and the editor cannot disagree about what "Title is
 * on" means — the toolbar renders from these keys and the editor answers from
 * the same ones.
 */
export const TOOL_STATE: readonly { key: string; name: string; attrs?: Record<string, unknown> }[] = [
  { key: 'bold', name: 'bold' },
  { key: 'italic', name: 'italic' },
  { key: 'strike', name: 'strike' },
  { key: 'title', name: 'heading', attrs: { level: 1 } },
  { key: 'subtitle', name: 'heading', attrs: { level: 2 } },
  { key: 'bullet', name: 'bulletList' },
  { key: 'number', name: 'orderedList' },
]

/** The whole schema, in one place, for the editor and its tests. */
export function noteExtensions(placeholder: string) {
  return [
    Document, Paragraph, Text,
    NoteHardBreak, NoteHeading,
    BulletList, OrderedList, NoteListItem,
    Bold, Italic, NoteStrike,
    UndoRedo,
    Placeholder.configure({ placeholder }),
    HeadingDisplayLevel, MarksHugTheirContent, NoteLengthCap, PlainTextOnly,
  ]
}
