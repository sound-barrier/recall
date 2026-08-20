import { describe, expect, it } from 'vitest'

import { applyInlineMark, applyLineMark } from '@/match/markdown/note-toolbar'

describe('applyInlineMark', () => {
  it('wraps the selection and keeps it selected', () => {
    expect(applyInlineMark('hold the angle', 5, 8, 'bold')).toEqual({
      text: 'hold **the** angle',
      start: 7,
      end: 10,
    })
  })

  it('parks the caret between the markers when nothing is selected', () => {
    expect(applyInlineMark('', 0, 0, 'italic')).toEqual({ text: '**', start: 1, end: 1 })
  })

  it('takes the mark off on a second press', () => {
    const on = applyInlineMark('hold the angle', 5, 8, 'strike')
    expect(applyInlineMark(on.text, on.start, on.end, 'strike')).toEqual({
      text: 'hold the angle',
      start: 5,
      end: 8,
    })
  })
})

describe('applyLineMark', () => {
  it('leaves a collapsed caret collapsed', () => {
    // A wide selection here means the next keystroke eats the line the
    // button just marked.
    const edit = applyLineMark('hold the angle', 7, 7, 'bullet')
    expect(edit.text).toBe('- hold the angle')
    expect(edit.start).toBe(9)
    expect(edit.end).toBe(9)
  })

  it('puts the caret after the marker it inserted on an empty note', () => {
    const edit = applyLineMark('', 0, 0, 'bullet')
    expect(edit).toEqual({ text: '- ', start: 2, end: 2 })
  })

  it('marks every line the selection touches', () => {
    const edit = applyLineMark('one\ntwo', 1, 5, 'bullet')
    expect(edit.text).toBe('- one\n- two')
  })

  it('replaces a different mark rather than stacking one on top', () => {
    expect(applyLineMark('# Title', 2, 2, 'bullet').text).toBe('- Title')
  })

  it('takes the mark off when every touched line already carries it', () => {
    expect(applyLineMark('- one\n- two', 0, 11, 'bullet').text).toBe('one\ntwo')
  })

  it('unmarks a partially selected list rather than renumbering it from 1', () => {
    // Selection covers only the last two rows. Reading "already numbered"
    // off the exact prefix this press would write saw "not marked" and
    // produced `1. 1. 2.`; reading it off ANY number toggles cleanly.
    const edit = applyLineMark('1. a\n2. b\n3. c', 5, 14, 'number')
    expect(edit.text).toBe('1. a\nb\nc')
  })

  it('numbers from one past the line above', () => {
    const edit = applyLineMark('1. a\nb\nc', 5, 8, 'number')
    expect(edit.text).toBe('1. a\n2. b\n3. c')
  })

  it('numbers from 1 when nothing precedes the block', () => {
    expect(applyLineMark('a\nb', 0, 3, 'number').text).toBe('1. a\n2. b')
  })
})
