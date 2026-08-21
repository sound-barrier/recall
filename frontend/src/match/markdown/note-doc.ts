/**
 * The note grammar as a DOCUMENT, and back again.
 *
 * A WYSIWYG editor holds a tree, not a string, so the note has to cross that
 * boundary twice: blocks in on load, markdown out on save. Both directions
 * live here, over a plain-JSON node type that happens to match ProseMirror's
 * shape — no editor library is imported, so the whole round trip is testable
 * before the dependency exists. That ordering is deliberate: if the round trip
 * does not hold, we find out before adding ~400 KB of it.
 *
 * The load side makes NO lexical decisions. It consumes what note-blocks.ts
 * parsed, so the editor cannot recognize a heading the ledger would not.
 *
 * The save side is the only new opinion in the feature, and it is small: three
 * marks in a canonical order, `- ` for bullets, `N. ` for numbers, `#`/`##`
 * from the level the block kept. What that costs is spelled out in
 * note-doc.test.ts as a table — a note's stored text can come back cosmetically
 * different, and the invariant is that it always RENDERS the same.
 */

import {
  blocksOf, inlineSpans, topHeadingLevel,
  type Block, type Span, type SpanMark,
} from '@/match/markdown/note-blocks'

/**
 * The longest note the server will take, in RUNES — pkg/coach/note.go counts
 * the same way, over the same serialized markdown.
 *
 * It lives here rather than beside the editor because the editor is behind a
 * dynamic import: a component reaching into note-tiptap.ts for this constant
 * pulls every @tiptap package into its own static chunk, and the async
 * boundary stops meaning anything.
 */
export const MAX_NOTE_TEXT = 4000

/** The editor's mark names. ProseMirror's, not the HTML tag names. */
export type DocMark = 'bold' | 'italic' | 'strike'

const MARK_OF: Record<SpanMark, DocMark> = { strong: 'bold', em: 'italic', del: 'strike' }

/**
 * Canonical mark order, and it is load-bearing rather than tidy.
 *
 * A document model holds marks as an unordered set, so the serializer has to
 * pick an order — and this one is the only one that round-trips the whole
 * lattice. bold+italic emits `**` + `*` = `***`, which the lexer's
 * longest-run-first table reads back as exactly that pair. Reverse them and
 * `*` + `**` = `***` still, but the closing run would be `**` + `*`, and the
 * note would drift by a character every save.
 */
const MARK_ORDER: readonly DocMark[] = ['bold', 'italic', 'strike']

const MARKER_OF: Record<DocMark, string> = { bold: '**', italic: '*', strike: '~~' }

export interface DocText {
  type: 'text'
  text: string
  marks?: { type: DocMark }[]
}

export interface DocBreak { type: 'hardBreak' }

export type DocInline = DocText | DocBreak

export interface DocParagraph { type: 'paragraph'; content?: DocInline[] }
export interface DocHeading {
  type: 'heading'
  /** What the author wrote — `#` or `##`. The serializer reads this. */
  attrs: { level: 1 | 2; displayLevel: 3 | 4 }
  content?: DocInline[]
}
export interface DocListItem { type: 'listItem'; content: DocParagraph[] }
export interface DocBulletList { type: 'bulletList'; content: DocListItem[] }
export interface DocOrderedList {
  type: 'orderedList'
  attrs: { start: number }
  content: DocListItem[]
}

export type DocBlock = DocParagraph | DocHeading | DocBulletList | DocOrderedList

export interface NoteDoc { type: 'doc'; content: DocBlock[] }

// ── load ────────────────────────────────────────────────────────────────

function inlineOf(raw: string): DocInline[] {
  return inlineSpans(raw).map(textNode)
}

function textNode(span: Span): DocText {
  const marks = span.marks.map((m) => ({ type: MARK_OF[m] }))
  return marks.length > 0 ? { type: 'text', text: span.text, marks } : { type: 'text', text: span.text }
}

/** A paragraph's soft breaks are hardBreak nodes between its lines. */
function paragraphOf(lines: readonly string[]): DocParagraph {
  const content: DocInline[] = []
  lines.forEach((line, i) => {
    if (i > 0) content.push({ type: 'hardBreak' })
    content.push(...inlineOf(line))
  })
  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }
}

function itemsOf(items: readonly string[]): DocListItem[] {
  // The paragraph wrapper is required by the editor's schema, not by the
  // grammar: prosemirror-schema-list splits a BLOCK inside the item, so an
  // inline-only item breaks Enter and the list buttons. See note-tiptap.ts.
  return items.map((text) => ({ type: 'listItem', content: [paragraphOf([text])] }))
}

function blockToDoc(block: Block, topLevel: number): DocBlock {
  switch (block.kind) {
    case 'p':
      return paragraphOf(block.lines)
    case 'h':
      return {
        type: 'heading',
        // level is what the author wrote; displayLevel is which tag to paint,
        // and it is the SAME arithmetic the HTML emitter does — the editor
        // shows the ledger's headings, not its own.
        attrs: { level: block.level, displayLevel: (3 + block.level - topLevel) as 3 | 4 },
        content: inlineOf(block.text),
      }
    case 'ul':
      return { type: 'bulletList', content: itemsOf(block.items) }
    case 'ol':
      return { type: 'orderedList', attrs: { start: block.start }, content: itemsOf(block.items) }
  }
}

/**
 * A note's markdown as an editor document.
 *
 * An empty note still yields one empty paragraph: ProseMirror's `doc` is
 * `block+` and cannot hold nothing. `docToMarkdown` maps that straight back to
 * the empty string, so the pair still round-trips.
 */
export function blocksToDoc(blocks: readonly Block[]): NoteDoc {
  if (blocks.length === 0) return { type: 'doc', content: [{ type: 'paragraph' }] }
  const topLevel = topHeadingLevel(blocks)
  return { type: 'doc', content: blocks.map((b) => blockToDoc(b, topLevel)) }
}

/** The whole load path, for callers that have text rather than blocks. */
export function textToDoc(source: string): NoteDoc {
  return blocksToDoc(blocksOf(source))
}

// ── save ────────────────────────────────────────────────────────────────

function marksOf(node: DocText): DocMark[] {
  const held = new Set((node.marks ?? []).map((m) => m.type))
  return MARK_ORDER.filter((m) => held.has(m))
}

function wrap(text: string, marks: readonly DocMark[]): string {
  const open = marks.map((m) => MARKER_OF[m]).join('')
  const close = [...marks].reverse().map((m) => MARKER_OF[m]).join('')
  return open + text + close
}

/**
 * Inline content back to markdown, coalescing runs that carry the same marks.
 *
 * Coalescing is not cosmetic: `**a****b**` parses to two adjacent bold spans,
 * and emitting them separately would write those four asterisks back out for
 * the reader to trip over. One run of marks per marker pair.
 */
function inlineToMarkdown(content: readonly DocInline[] | undefined): string[] {
  const lines: string[] = ['']
  let pending = ''
  let pendingMarks: DocMark[] = []
  const flush = (): void => {
    if (pending !== '') lines[lines.length - 1] += wrap(pending, pendingMarks)
    pending = ''
    pendingMarks = []
  }
  for (const node of content ?? []) {
    if (node.type === 'hardBreak') {
      flush()
      lines.push('')
      continue
    }
    if (node.text === '') continue
    const marks = marksOf(node)
    if (pending !== '' && sameMarks(marks, pendingMarks)) {
      pending += node.text
      continue
    }
    flush()
    pending = node.text
    pendingMarks = marks
  }
  flush()
  return lines
}

function sameMarks(a: readonly DocMark[], b: readonly DocMark[]): boolean {
  return a.length === b.length && a.every((m, i) => m === b[i])
}

function itemLines(items: readonly DocListItem[], marker: (i: number) => string): string {
  return items
    .map((item, i) => marker(i) + inlineToMarkdown(item.content[0]?.content).join(' '))
    .join('\n')
}

function blockToMarkdown(block: DocBlock): string {
  switch (block.type) {
    case 'paragraph':
      return inlineToMarkdown(block.content).join('\n')
    case 'heading':
      return '#'.repeat(block.attrs.level) + ' ' + inlineToMarkdown(block.content).join(' ')
    case 'bulletList':
      return itemLines(block.content, () => '- ')
    case 'orderedList':
      return itemLines(block.content, (i) => `${block.attrs.start + i}. `)
  }
}

/**
 * An editor document back to the markdown that gets stored.
 *
 * Blocks that serialize to nothing are dropped rather than emitted as blank
 * lines — an empty paragraph is what ProseMirror requires of an empty note,
 * not something the author wrote.
 */
export function docToMarkdown(doc: NoteDoc): string {
  return doc.content
    .map(blockToMarkdown)
    .filter((s) => s !== '')
    .join('\n\n')
}
