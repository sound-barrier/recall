import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { renderInlineMarkdown, renderMarkdown, renderMarkdownWithHits } from '@/match/markdown/render-markdown'

// The SHARED table, read straight from where the Go renderer reads it. Two
// implementations of one grammar only stay honest if a single fixture pins
// them — so this suite and pkg/coach's TestRenderMarkdown execute the same
// pairs, and a case added to the file fails whichever side has not caught up.
const FIXTURE = resolve(__dirname, './testdata/markdown_cases.json')
const cases = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  cases: { name: string; in: string; out: string }[]
}).cases

describe('renderMarkdown — the shared note grammar', () => {
  it('has cases to run', () => {
    expect(cases.length).toBeGreaterThan(20)
  })

  it.each(cases.map((c) => [c.name, c.in, c.out] as const))(
    '%s', (_name, input, expected) => {
      expect(renderMarkdown(input)).toBe(expected)
    },
  )
})

describe('renderMarkdownWithHits — the frontend-only sibling', () => {
  // The ledger has no search box, so this never crosses to Go and the fixture
  // never sees it. renderMarkdown itself must stay byte-identical either way.
  it('renders exactly like renderMarkdown when nothing is searched', () => {
    for (const src of ['# Focus\n\n- angle\n- ult', 'Hold **the angle** first.', '']) {
      expect(renderMarkdownWithHits(src, [])).toBe(renderMarkdown(src))
      expect(renderMarkdownWithHits(src, [''])).toBe(renderMarkdown(src))
    }
  })

  it('lights a hit without disturbing the markup around it', () => {
    expect(renderMarkdownWithHits('Hold the angle', ['angle']))
      .toBe('<p>Hold the <mark class="note-hit">angle</mark></p>')
  })

  // The reason it splits SPANS rather than the source: a term inside emphasis
  // used to be unfindable, because the characters the author typed were
  // `**hold**` and the word a reader sees is `hold`.
  it('finds a term inside emphasis, which the source never could', () => {
    expect(renderMarkdownWithHits('**hold** the angle', ['hold']))
      .toBe('<p><strong><mark class="note-hit">hold</mark></strong> the angle</p>')
  })

  it('matches without regard to case, and keeps what was typed', () => {
    expect(renderMarkdownWithHits('Hold the Angle', ['angle']))
      .toBe('<p>Hold the <mark class="note-hit">Angle</mark></p>')
  })

  it('lights hits in headings and list items too', () => {
    expect(renderMarkdownWithHits('# Ult economy\n\n- ult first', ['ult']))
      .toBe('<h3><mark class="note-hit">Ult</mark> economy</h3>'
        + '<ul><li><mark class="note-hit">ult</mark> first</li></ul>')
  })

  // Same escape-first guarantee as its sibling: a term cannot open a tag, and
  // neither can the text around it.
  it('escapes the text and the hit alike', () => {
    expect(renderMarkdownWithHits('<script>x</script>', ['script']))
      .toContain('&lt;<mark class="note-hit">script</mark>&gt;')
    expect(renderMarkdownWithHits('a & b', ['&'])).toContain('<mark class="note-hit">&amp;</mark>')
  })
})

// ── inline-only rendering, for captions ─────────────────────────────────
//
// A moment is one line beside a clock: it wants emphasis, not block
// structure. Rendering it through renderMarkdown would put a <p> inside the
// <li>'s span.
describe('renderInlineMarkdown', () => {
  it('renders emphasis without wrapping it in a block', () => {
    expect(renderInlineMarkdown('**do not** peek there')).toBe('<strong>do not</strong> peek there')
  })

  it('escapes before it emphasizes', () => {
    expect(renderInlineMarkdown('<img src=x onerror=y> *late*'))
      .toBe('&lt;img src=x onerror=y&gt; <em>late</em>')
  })

  it('nests the way the block renderer does', () => {
    expect(renderInlineMarkdown('~~*a*~~')).toBe('<del><em>a</em></del>')
  })

  it('keeps a second line as a break, not a paragraph', () => {
    expect(renderInlineMarkdown('first\nsecond')).toBe('first<br>second')
  })

  it('leaves a plain caption exactly as it was', () => {
    expect(renderInlineMarkdown('no off-angle')).toBe('no off-angle')
  })

  it('renders an empty caption as nothing', () => {
    expect(renderInlineMarkdown('')).toBe('')
  })

  it('does not turn a leading dash into a list', () => {
    // Block structure is exactly what a caption must not grow.
    expect(renderInlineMarkdown('- not a list')).toBe('- not a list')
  })

  it('does not turn a leading hash into a heading', () => {
    expect(renderInlineMarkdown('# not a heading')).toBe('# not a heading')
  })
})
