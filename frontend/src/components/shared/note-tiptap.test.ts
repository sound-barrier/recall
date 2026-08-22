import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { markdownOf, noteExtensions } from '@/components/shared/note-tiptap'
import { MAX_NOTE_TEXT } from '@/match/markdown/note-doc'
import { textToDoc } from '@/match/markdown/note-doc'
import { renderMarkdown } from '@/match/markdown/render-markdown'

const cases = JSON.parse(readFileSync(
  resolve(__dirname, '../../match/markdown/testdata/markdown_cases.json'), 'utf8',
)).cases as { name: string; in: string; out: string }[]

let editor: Editor | undefined

function open(text = ''): Editor {
  editor = new Editor({ extensions: noteExtensions('Write a note'), content: textToDoc(text) })
  return editor
}

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

/**
 * Both HTML strings put through ONE serializer before comparing.
 *
 * Otherwise this compares serializers rather than documents: renderMarkdown
 * escapes a quote to `&#34;` and TipTap does not, and TipTap writes a
 * non-breaking space as `&nbsp;` where renderMarkdown emits the character. The
 * DOM is identical in both cases — only the spelling of it differs, and the
 * spelling is not the thing under test.
 */
function sameDOM(html: string): string {
  const host = document.createElement('div')
  host.innerHTML = html
  return host.innerHTML
}

/**
 * The one documented difference between the two DOMs.
 *
 * A list item wraps its text in a paragraph in the editor and does not in the
 * ledger, because prosemirror-schema-list splits a BLOCK inside the item — an
 * inline-only item makes Enter stop creating bullets and the list buttons stop
 * working. note-prose.css trims that paragraph's margins on both surfaces, so
 * nothing about it reaches the reader; unwrapping it here is what lets the rest
 * of the markup be compared for exact equality.
 */
function unwrapListParagraphs(html: string): string {
  return html.replace(/<li><p>(.*?)<\/p><\/li>/g, '<li>$1</li>')
}

/** The editor's HTML, with the empty paragraph ProseMirror requires stripped. */
function editorHTML(e: Editor): string {
  return sameDOM(unwrapListParagraphs(e.getHTML()).replace(/<p><\/p>/g, ''))
}

describe('the editor paints what the ledger paints', () => {
  // THE load invariant. The editor's DOM and the exported ledger's DOM are the
  // same markup, produced by two different emitters over one parse — so the
  // editor cannot show a heading, a list or an emphasis the coach will not get.
  it.each(cases.map((c) => [c.name, c.in] as const))('%s', (_name, src) => {
    expect(editorHTML(open(src))).toBe(sameDOM(renderMarkdown(src)))
  })
})

describe('the editor gives back the markdown it was given', () => {
  it.each(cases.map((c) => [c.name, c.in] as const))('%s', (_name, src) => {
    // Loading and reading back changes nothing on its own — normalization is
    // something an EDIT does, never something opening a note does.
    expect(renderMarkdown(markdownOf(open(src).state.doc))).toBe(renderMarkdown(src))
  })
})

describe('the schema refuses what the grammar cannot say', () => {
  it('has no node for a link, an image, a table, a code block or a quote', () => {
    const names = Object.keys(open().schema.nodes)
    expect(names.sort()).toEqual([
      'bulletList', 'doc', 'hardBreak', 'heading', 'listItem',
      'orderedList', 'paragraph', 'text',
    ])
  })

  it('has exactly the three marks the grammar carries', () => {
    expect(Object.keys(open().schema.marks).sort()).toEqual(['bold', 'italic', 'strike'])
  })

  // A schema is what a paste is filtered through, so this is the real
  // guarantee rather than a naming check.
  it('drops markup the grammar has no home for', () => {
    const e = open()
    e.commands.setContent('<p>a <a href="http://x">link</a> and <code>code</code></p>')
    expect(markdownOf(e.state.doc)).toBe('a link and code')
  })

  it('has no nested list to spell, so a list item holds one paragraph', () => {
    expect(open().schema.nodes.listItem!.spec.content).toBe('paragraph')
  })
})

// The commands the toolbar and the Enter key depend on. Asserted because the
// schema decides whether they work at all: an inline-only list item silently
// turns every one of these into a no-op.
describe('list editing still works', () => {
  // Presses the KEY, not the command behind it. Unbinding Tab by returning an
  // empty shortcut map also unbinds Enter, and a test that calls
  // commands.splitListItem() directly sails straight past that.
  it('splits a list item into the next bullet when Enter is pressed', () => {
    const e = open('- one')
    e.commands.setTextSelection(6)
    const enter = e.view.someProp('handleKeyDown', (f) => f(
      e.view, new KeyboardEvent('keydown', { key: 'Enter' })))
    expect(enter).toBe(true)
    e.commands.insertContent('two')
    expect(markdownOf(e.state.doc)).toBe('- one\n- two')
  })

  it('leaves Tab unbound so focus can escape the field', () => {
    const e = open('- one')
    e.commands.setTextSelection(6)
    const tab = e.view.someProp('handleKeyDown', (f) => f(
      e.view, new KeyboardEvent('keydown', { key: 'Tab' })))
    expect(tab).toBeFalsy()
  })

  it('turns a paragraph into a bullet and back', () => {
    const e = open('plain')
    expect(e.commands.toggleBulletList()).toBe(true)
    expect(markdownOf(e.state.doc)).toBe('- plain')
    expect(e.commands.toggleBulletList()).toBe(true)
    expect(markdownOf(e.state.doc)).toBe('plain')
  })

  it('turns a paragraph into a numbered item', () => {
    const e = open('plain')
    expect(e.commands.toggleOrderedList()).toBe(true)
    expect(markdownOf(e.state.doc)).toBe('1. plain')
  })
})

describe('marks hug their content', () => {
  // The case a browser hands you for free: double-clicking a word selects its
  // trailing space, so Bold would write `**hold **` — which is not bold at
  // all, it is italic with two literal asterisks. The grammar has no escape
  // syntax, so the state has to be unreachable rather than repaired.
  it('shrinks a mark off a trailing space', () => {
    const e = open('hold the angle')
    e.commands.setTextSelection({ from: 1, to: 6 }) // "hold " — space included
    e.commands.setBold()
    expect(markdownOf(e.state.doc)).toBe('**hold** the angle')
  })

  it('shrinks a mark off a leading space', () => {
    const e = open('hold the angle')
    e.commands.setTextSelection({ from: 5, to: 9 }) // " the"
    e.commands.setBold()
    expect(markdownOf(e.state.doc)).toBe('hold **the** angle')
  })

  it('keeps a mark off a marker character at the edge', () => {
    const e = open('a* b')
    e.commands.setTextSelection({ from: 1, to: 3 }) // "a*"
    e.commands.setBold()
    // `**a***` would read back as bold-a plus a stray star, so the star is
    // left outside the mark and the note still says what it looks like.
    expect(markdownOf(e.state.doc)).toBe('**a*** b')
  })
})

describe('the heading a note paints follows the note around it', () => {
  it('repaints a lone subheading when a title appears above it', () => {
    const e = open('## Second half')
    expect(editorHTML(e)).toBe(sameDOM('<h3>Second half</h3>'))

    e.commands.setTextSelection(0)
    e.commands.insertContent(textToDoc('# First half').content)
    expect(editorHTML(e)).toBe(sameDOM('<h3>First half</h3><h4>Second half</h4>'))
    // …and the authored levels are untouched by any of that repainting.
    expect(markdownOf(e.state.doc)).toBe('# First half\n\n## Second half')
  })
})

describe('the length cap counts what the server counts', () => {
  it('refuses a note past the cap', () => {
    const e = open('x'.repeat(MAX_NOTE_TEXT))
    e.commands.insertContentAt(MAX_NOTE_TEXT, 'more')
    expect([...markdownOf(e.state.doc)].length).toBe(MAX_NOTE_TEXT)
  })

  it('always lets a note get shorter', () => {
    const e = open('x'.repeat(MAX_NOTE_TEXT))
    e.commands.setTextSelection({ from: 1, to: 100 })
    e.commands.deleteSelection()
    expect([...markdownOf(e.state.doc)].length).toBeLessThan(MAX_NOTE_TEXT)
  })

  // The cap is on the markdown, not the visible text: `**bold**` costs four
  // characters more than the word it emphasizes, and the server counts those.
  it('counts the markers, not just the words', () => {
    const e = open()
    e.commands.insertContent(textToDoc('**bold**').content)
    expect([...markdownOf(e.state.doc)].length).toBe('**bold**'.length)
  })
})
