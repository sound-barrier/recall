import { describe, expect, it } from 'vitest'

import { blocksOf, inlineSpans, notePlainText } from '@/match/markdown/note-blocks'
import { renderMarkdown } from '@/match/markdown/render-markdown'

// The parser is the half of the grammar that is NOT lossy. That distinction is
// the reason this module exists, so it is the first thing pinned here.

describe('blocksOf — the heading level the emitter throws away', () => {
  // renderMarkdown normalizes a note's shallowest heading to h3, so `#` alone
  // and `##` alone produce identical HTML. An editor loading from that HTML
  // would rewrite one into the other the moment anyone typed. The block keeps
  // what the author actually wrote.
  it('keeps level 2 for a note whose only heading is a subheading', () => {
    expect(renderMarkdown('## Second half')).toBe('<h3>Second half</h3>')
    expect(renderMarkdown('# Second half')).toBe('<h3>Second half</h3>')

    expect(blocksOf('## Second half')).toEqual([{ kind: 'h', level: 2, text: 'Second half' }])
    expect(blocksOf('# Second half')).toEqual([{ kind: 'h', level: 1, text: 'Second half' }])
  })

  it('keeps both levels when a note uses both', () => {
    expect(blocksOf('# First half\n## Second half')).toEqual([
      { kind: 'h', level: 1, text: 'First half' },
      { kind: 'h', level: 2, text: 'Second half' },
    ])
  })

  it('keeps a numbered list\'s start, which the emitter only prints when it is not 1', () => {
    expect(blocksOf('3. third\n4. fourth')).toEqual([
      { kind: 'ol', items: ['third', 'fourth'], start: 3 },
    ])
    expect(blocksOf('1. first')).toEqual([{ kind: 'ol', items: ['first'], start: 1 }])
  })
})

describe('inlineSpans — marks as sets, over raw text', () => {
  it('carries nested marks as one set on the inner span', () => {
    expect(inlineSpans('Hold **the *high* ground** first.')).toEqual([
      { text: 'Hold ', marks: [] },
      { text: 'the ', marks: ['strong'] },
      { text: 'high', marks: ['strong', 'em'] },
      { text: ' ground', marks: ['strong'] },
      { text: ' first.', marks: [] },
    ])
  })

  it('expands the both-marker into the two marks it stands for', () => {
    expect(inlineSpans('***hold the angle***')).toEqual([
      { text: 'hold the angle', marks: ['strong', 'em'] },
    ])
  })

  // The same crossed-marker case the emitter's recursion exists for: the inner
  // `*` never closes, so it stays part of the text rather than opening a mark.
  it('leaves an unclosed marker in the text', () => {
    expect(inlineSpans('**a *b** c*')).toEqual([
      { text: 'a *b', marks: ['strong'] },
      { text: ' c*', marks: [] },
    ])
    expect(inlineSpans('**not closed')).toEqual([{ text: '**not closed', marks: [] }])
  })

  // Escaping happens at render time from the text node, so the parser must
  // hand back exactly what was typed — entities here would be stored.
  it('does not escape', () => {
    expect(inlineSpans('<script>alert(1)</script>')).toEqual([
      { text: '<script>alert(1)</script>', marks: [] },
    ])
  })

  // A marker that does not hug its content is not bold — and what it becomes
  // instead is worse than nothing happening. `**hold **` is what a browser
  // hands you when you double-click a word (the selection takes the trailing
  // space) and press Bold, and it renders as ITALIC with literal asterisks.
  // The editor has to keep marks off the whitespace so this cannot be typed.
  it('does not make bold out of a marker with a space inside it', () => {
    expect(inlineSpans('**hold **')).toEqual([{ text: '*hold *', marks: ['em'] }])
    expect(inlineSpans('** hold **')).toEqual([{ text: '* hold *', marks: ['em'] }])
  })

  // The two emitters share a lexer, so they must agree on which characters are
  // text and which were markers. Strip the tags off the HTML and the two have
  // to say the same thing — this is what keeps them from drifting apart.
  it.each([
    'Hold **the *high* ground** first.',
    '***hold the angle***',
    '**a *b** c*',
    '**not closed',
    '**hold **',
    '** hold **',
    '<script>alert(1)</script>',
  ])('agrees with the HTML emitter about %j', (src) => {
    const textOfHTML = renderMarkdown(src)
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#34;/g, '"').replace(/&#39;/g, "'")
    expect(inlineSpans(src).map((s) => s.text).join('')).toBe(textOfHTML)
  })
})

describe('notePlainText — for the one surface that can show neither', () => {
  // The reel frame's quote lives inside a <button>, where <p> and <ul> are an
  // invalid content model. It currently prints the raw markers at the reader.
  it('drops the markers and joins the blocks', () => {
    expect(notePlainText('# Ult economy\n\n- hold **it** for the dive\n- count their suzu'))
      .toBe('Ult economy hold it for the dive count their suzu')
  })

  it('is empty for an empty note', () => {
    expect(notePlainText('')).toBe('')
    expect(notePlainText('   \n\n  ')).toBe('')
  })
})
