import { describe, it, expect } from 'vitest'
import { parseSearchQuery, highlightTermsFor } from '@/match/search-query'

describe('parseSearchQuery', () => {
  it('returns an empty list for empty / whitespace-only input', () => {
    expect(parseSearchQuery('')).toEqual([])
    expect(parseSearchQuery('   ')).toEqual([])
  })

  it('parses a single bare token as a global clause', () => {
    expect(parseSearchQuery('clutch')).toEqual([{ field: null, value: 'clutch' }])
  })

  it('parses a field-scoped token', () => {
    expect(parseSearchQuery('note:clutch')).toEqual([{ field: 'note', value: 'clutch' }])
    expect(parseSearchQuery('replay:7H1K9P')).toEqual([{ field: 'replay', value: '7h1k9p' }])
    expect(parseSearchQuery('member:Apollo#11234')).toEqual([{ field: 'member', value: 'apollo#11234' }])
    expect(parseSearchQuery('tag:stack')).toEqual([{ field: 'tag', value: 'stack' }])
  })

  it('collapses plural field aliases to the canonical singular', () => {
    expect(parseSearchQuery('notes:x')).toEqual([{ field: 'note', value: 'x' }])
    expect(parseSearchQuery('members:Apollo')).toEqual([{ field: 'member', value: 'apollo' }])
    expect(parseSearchQuery('tags:stack')).toEqual([{ field: 'tag', value: 'stack' }])
  })

  it('treats unknown field prefixes as bare text', () => {
    // `bogus:foo` is one literal token; the leading "bogus:" doesn't
    // map to any field so the whole thing is a bare clause.
    expect(parseSearchQuery('bogus:foo')).toEqual([{ field: null, value: 'bogus:foo' }])
  })

  it('parses multiple tokens as separate AND-clauses', () => {
    expect(parseSearchQuery('tag:stack note:clutch')).toEqual([
      { field: 'tag', value: 'stack' },
      { field: 'note', value: 'clutch' },
    ])
  })

  it('handles quoted values with embedded whitespace', () => {
    expect(parseSearchQuery('note:"huge clutch"')).toEqual([
      { field: 'note', value: 'huge clutch' },
    ])
    expect(parseSearchQuery('"two words"')).toEqual([
      { field: null, value: 'two words' },
    ])
  })

  it('handles an unclosed quote by consuming to end of input', () => {
    expect(parseSearchQuery('note:"missing close')).toEqual([
      { field: 'note', value: 'missing close' },
    ])
  })

  it('lowercases the value', () => {
    expect(parseSearchQuery('CLUTCH')).toEqual([{ field: null, value: 'clutch' }])
    expect(parseSearchQuery('Note:CLUTCH')).toEqual([{ field: 'note', value: 'clutch' }])
  })

  it('handles repeated whitespace between tokens', () => {
    expect(parseSearchQuery('  tag:stack    note:clutch  ')).toEqual([
      { field: 'tag', value: 'stack' },
      { field: 'note', value: 'clutch' },
    ])
  })

  it('drops empty-value clauses (mid-type trailing colon)', () => {
    // User mid-type: `note:` with nothing after — filter stays inert.
    expect(parseSearchQuery('note:')).toEqual([])
    // Even when alongside other valid clauses.
    expect(parseSearchQuery('note: tag:stack')).toEqual([
      { field: 'tag', value: 'stack' },
    ])
  })

  it('handles a bare colon without a field as a literal value', () => {
    // `:foo` — colon at position 0, no field name → bare text.
    expect(parseSearchQuery(':foo')).toEqual([{ field: null, value: ':foo' }])
  })

  it('handles three+ clauses chained together', () => {
    expect(parseSearchQuery('note:a tag:b member:c')).toEqual([
      { field: 'note', value: 'a' },
      { field: 'tag', value: 'b' },
      { field: 'member', value: 'c' },
    ])
  })
})

describe('highlightTermsFor', () => {
  it('returns terms from bare clauses for every field', () => {
    const clauses = parseSearchQuery('clutch')
    expect(highlightTermsFor('note', clauses)).toEqual(['clutch'])
    expect(highlightTermsFor('replay', clauses)).toEqual(['clutch'])
    expect(highlightTermsFor('member', clauses)).toEqual(['clutch'])
    expect(highlightTermsFor('tag', clauses)).toEqual(['clutch'])
  })

  it('returns scoped terms only for the matching field', () => {
    const clauses = parseSearchQuery('note:clutch')
    expect(highlightTermsFor('note', clauses)).toEqual(['clutch'])
    expect(highlightTermsFor('replay', clauses)).toEqual([])
    expect(highlightTermsFor('member', clauses)).toEqual([])
    expect(highlightTermsFor('tag', clauses)).toEqual([])
  })

  it('mixes bare and scoped clauses per field', () => {
    const clauses = parseSearchQuery('clutch tag:stack')
    expect(highlightTermsFor('note', clauses)).toEqual(['clutch'])
    expect(highlightTermsFor('tag', clauses)).toEqual(['clutch', 'stack'])
  })

  it('dedupes overlapping terms', () => {
    const clauses = parseSearchQuery('clutch note:clutch')
    expect(highlightTermsFor('note', clauses)).toEqual(['clutch'])
  })
})
