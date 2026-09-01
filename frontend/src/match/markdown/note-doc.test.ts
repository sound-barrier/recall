import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { blocksOf } from '@/match/markdown/note-blocks'
import { blocksToDoc, docToMarkdown, textToDoc, type NoteDoc, wordCount } from '@/match/markdown/note-doc'
import { renderMarkdown } from '@/match/markdown/render-markdown'

// The same table both grammar implementations are pinned to, reached across
// the repo rather than copied — see render-markdown.test.ts.
const cases = JSON.parse(readFileSync(
  resolve(__dirname, './testdata/markdown_cases.json'), 'utf8',
)).cases as { name: string; in: string; out: string }[]

const roundTrip = (src: string): string => docToMarkdown(textToDoc(src))

describe('the note round trip, over the shared fixture', () => {
  it('reads the fixture the other two suites read', () => {
    expect(cases.length).toBeGreaterThan(20)
  })

  // THE invariant. A note may come back cosmetically different, but it must
  // never come back MEANING something different — what the coach receives is
  // the rendered output, and that is what may not move.
  it.each(cases.map((c) => [c.name, c.in] as const))(
    'renders identically after a round trip: %s', (_name, src) => {
      expect(renderMarkdown(roundTrip(src))).toBe(renderMarkdown(src))
    },
  )

  // The stronger claim: most notes come back byte-identical too. Asserted as
  // the exact SET of cases that do not, rather than a hand-kept skip list —
  // a new fixture case that normalizes then shows up here as a diff, and a
  // case that stops normalizing does too.
  it('normalizes exactly these fixture cases and no others', () => {
    const normalized = cases.filter((c) => roundTrip(c.in) !== c.in).map((c) => c.name)
    expect(normalized.sort()).toEqual([
      'a tab after the marker opens a list',
      'a title above a subheading keeps both levels',
      'trailing and leading blank lines are dropped',
      'whitespace-only input renders nothing',
    ])
    // 30 of the 34 come back byte-identical, and every one of the 34 comes
    // back rendering identically — which is the claim that matters.
    expect(cases.length - normalized.length).toBe(30)
  })
})

describe('what a round trip is allowed to change', () => {
  // The complete list. A change here is a deliberate test edit, not a
  // discovery — which is the point of writing it down.
  it.each([
    ['a star bullet becomes a dash', '* angle', '- angle'],
    ['a paren number becomes a dot', '1) x', '1. x'],
    ['a tab after the marker becomes a space', '-\tangle', '- angle'],
    ['surrounding blank lines go', '\n\nOne thought.\n\n', 'One thought.'],
    ['two headings gain a blank line between them', '# a\n## b', '# a\n\n## b'],
    ['an empty note stays empty', '', ''],
    ['a whitespace-only note is empty', '   \n\n  ', ''],
  ])('%s', (_name, src, want) => {
    expect(roundTrip(src)).toBe(want)
    // …and every one of them still renders the same as it did.
    expect(renderMarkdown(roundTrip(src))).toBe(renderMarkdown(src))
  })

  // The one that does NOT render byte-identically, and the reason it is fine.
  // `**a****b**` is two adjacent bold runs; merging them into one changes the
  // element count and nothing else — same text, same emphasis, same
  // accessibility tree. Emitting the four asterisks back out for a reader to
  // trip over would be the worse answer.
  it('merges adjacent identical marks, changing the tags but not the reading', () => {
    expect(roundTrip('**a****b**')).toBe('**ab**')
    expect(renderMarkdown('**a****b**')).toBe('<p><strong>a</strong><strong>b</strong></p>')
    expect(renderMarkdown('**ab**')).toBe('<p><strong>ab</strong></p>')
  })
})

describe('blocksToDoc — what the editor is handed', () => {
  it('keeps the level the author wrote, and paints the level the ledger paints', () => {
    // The whole reason the parser was carved out: `##` alone renders as h3,
    // and the document has to remember it was a `##` anyway.
    const doc = textToDoc('## Second half')
    expect(doc.content[0]).toEqual({
      type: 'heading',
      attrs: { level: 2, displayLevel: 3 },
      content: [{ type: 'text', text: 'Second half' }],
    })
    expect(renderMarkdown('## Second half')).toBe('<h3>Second half</h3>')
    expect(roundTrip('## Second half')).toBe('## Second half')
  })

  it('paints h3 then h4 when a note uses both', () => {
    const doc = textToDoc('# First half\n## Second half')
    expect(doc.content.map((b) => 'attrs' in b ? b.attrs : null)).toEqual([
      { level: 1, displayLevel: 3 },
      { level: 2, displayLevel: 4 },
    ])
  })

  it('turns soft breaks into hardBreak nodes', () => {
    expect(textToDoc('one\ntwo').content[0]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'one' },
        { type: 'hardBreak' },
        { type: 'text', text: 'two' },
      ],
    })
  })

  it('carries a numbered list\'s start onto the node', () => {
    const list = textToDoc('3. third\n4. fourth').content[0]
    expect(list).toMatchObject({ type: 'orderedList', attrs: { start: 3 } })
    expect(roundTrip('3. third\n4. fourth')).toBe('3. third\n4. fourth')
  })

  // ProseMirror's doc is `block+` and cannot hold nothing, so an empty note is
  // one empty paragraph — which must map straight back to the empty string or
  // every blank note would save as a stray blank line.
  it('gives an empty note exactly one empty paragraph', () => {
    expect(textToDoc('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(docToMarkdown(textToDoc(''))).toBe('')
  })

  it('does not escape — the document holds what was typed', () => {
    expect(textToDoc('<script>alert(1)</script>').content[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: '<script>alert(1)</script>' }],
    })
  })
})

describe('the two limits, chosen rather than discovered', () => {
  // ProseMirror holds marks as a set, so an authored nesting order cannot
  // survive. The paint and the accessibility tree are identical; the tags
  // swap. Written down so it is a decision, not a surprise.
  it('normalizes the nesting order of mixed marks', () => {
    expect(roundTrip('~~*a*~~')).toBe('*~~a~~*')
    expect(renderMarkdown('~~*a*~~')).toBe('<p><del><em>a</em></del></p>')
    expect(renderMarkdown(roundTrip('~~*a*~~'))).toBe('<p><em><del>a</del></del></em></p>'
      .replace('</del></del>', '</del>'))
  })

  // A mark whose body ends in its own marker character cannot be written down
  // — `**a***` reads back as bold-a plus a stray star. The editor prevents the
  // document from entering that state (see the marks-hug-content plugin); this
  // pins what the serializer does if one ever arrives another way.
  it('cannot spell a bold run whose body ends in a star', () => {
    const doc: NoteDoc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'a*', marks: [{ type: 'bold' }] }],
      }],
    }
    expect(docToMarkdown(doc)).toBe('**a***')
    expect(renderMarkdown('**a***')).not.toBe('<p><strong>a*</strong></p>')
  })
})

describe('blocksToDoc over blocks, not text', () => {
  it('is the same as textToDoc for the same source', () => {
    const src = '# Focus\n\n- angle\n- ult\n\nThat is it.'
    expect(blocksToDoc(blocksOf(src))).toEqual(textToDoc(src))
  })
})

describe('wordCount', () => {
  it('counts whitespace-separated runs', () => {
    expect(wordCount('one two three four five')).toBe(5)
  })

  it('is zero for an empty note', () => {
    expect(wordCount('')).toBe(0)
  })

  it('is zero for a note that is only whitespace', () => {
    // Otherwise an untouched field would claim one word.
    expect(wordCount('   \n\n  ')).toBe(0)
  })

  it('does not count a line break as a word', () => {
    expect(wordCount('first\nsecond')).toBe(2)
  })

  it('collapses runs of whitespace', () => {
    expect(wordCount('a     b')).toBe(2)
  })

  it('keeps a marked-up word as one word, the way it reads', () => {
    expect(wordCount('hold **the** ground')).toBe(3)
  })

  it('counts a single word as one', () => {
    expect(wordCount('alone')).toBe(1)
  })
})
