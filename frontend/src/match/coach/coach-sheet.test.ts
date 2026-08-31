import { describe, expect, it } from 'vitest'

import { buildCoachSheet, toSheetInput, type CoachSheetInput } from '@/match/coach/coach-sheet'

// The CSS is a PARAMETER, not an import, and that is a deliberate consequence
// of how Vite behaves under test: `?inline` CSS imports resolve to the EMPTY
// STRING in Vitest, so a builder that imported its own stylesheet would let
// "the sheet contains no url(" pass against an empty <style> and prove
// nothing. Handing it real CSS here makes every assertion below real.
const CSS = ':root{--ink:#111}.note-prose p{margin:0}'

function input(over: Partial<CoachSheetInput> = {}): CoachSheetInput {
  return {
    coachName: 'Ordo',
    playerHandle: 'Sable',
    sessionDate: '2026-08-15',
    focusItems: [],
    notes: [],
    ...over,
  }
}

function noteOf(over: Partial<CoachSheetInput['notes'][number]> = {}) {
  return {
    matchKey: 'replay-A1B2C3',
    kind: 'note',
    text: 'Hold the high ground.',
    focusTags: ['positioning'],
    extraTags: [],
    matchClock: '04:12',
    match: { map: 'ilios', hero: 'ana', result: 'defeat', date: '2026-08-15', finishedAt: '', replayCode: 'A1B2C3' },
    moments: [],
    ...over,
  }
}

describe('buildCoachSheet — the page a coach hands over', () => {
  it('is a self-contained document naming both people and the date', () => {
    const html = buildCoachSheet(input({ notes: [noteOf()] }), CSS)

    expect(html).toContain('<!doctype html>')
    expect(html).toContain('Ordo')
    expect(html).toContain('Sable')
    expect(html).toContain('2026-08-15')
    expect(html).toContain('Hold the high ground.')
    // The real stylesheet is embedded, not linked.
    expect(html).toContain('--ink:#111')
  })

  // Carried over in intent from the Go ledger's suite: this page is emailed,
  // opened offline, and must reach for nothing.
  //
  // Deliberately BENIGN content. The bare substrings below ('src=', 'href=',
  // 'http://') survive escaping unchanged — they carry no angle bracket — so
  // feeding this assertion hostile text would fail it for text that is
  // already inert. What hostile text must do is a separate claim, tested
  // directly beneath.
  it('reaches for nothing outside itself', () => {
    const html = buildCoachSheet(input({
      focusItems: [{ text: 'ult timing' }],
      notes: [noteOf({ moments: [{ matchClock: '02:30', text: 'ult here' }] })],
    }), CSS)

    for (const forbidden of [
      '<script', '<img', '<iframe', '<link', '<a ', 'href=', 'src=', 'srcset=',
      'http://', 'https://', '@import', 'url(', 'javascript:',
    ]) {
      expect(html, `sheet contains ${forbidden}`).not.toContain(forbidden)
    }
    expect(html).not.toMatch(/\son\w+\s*=/)
  })

  // The other half: text that TRIES to reach out lands inert.
  //
  // The Go version got this from html/template's contextual auto-escaping,
  // which made an unescaped interpolation impossible. String concatenation
  // offers no such guarantee, so this assertion is now the actual defense
  // rather than a second opinion.
  it('neutralizes text that tries to reach out', () => {
    const hostile = 'see <img src=x onerror=alert(1)> and <a href="javascript:alert(2)">x</a>'
    const html = buildCoachSheet(input({ notes: [noteOf({ text: hostile })] }), CSS)

    // No live tag survives. That is the whole proof: an inline handler can
    // only fire from inside a tag, and no `<` the coach typed becomes one.
    // (Asserting on ` onerror=` directly would be the same mistake as above
    // — it survives escaping as inert characters, so it says nothing.)
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('<script')
    // It is still THERE — as text the player can read, which is the point of
    // escaping rather than stripping.
    expect(html).toContain('&lt;img')
    expect(html).toContain('&lt;a href=')
  })

  it('carries exactly three metas — charset, CSP, viewport', () => {
    const html = buildCoachSheet(input(), CSS)
    expect(html.match(/<meta /g) ?? []).toHaveLength(3)
    expect(html).toContain("default-src 'none'")
  })

  it('renders the note grammar rather than printing its markers', () => {
    const html = buildCoachSheet(input({
      notes: [noteOf({ text: 'Hold **the angle** first.\n\n- rotate\n- regroup' })],
    }), CSS)
    expect(html).toContain('<strong>the angle</strong>')
    expect(html).toContain('<li>rotate</li>')
    expect(html).not.toContain('**the angle**')
  })

  it('escapes everything a coach or a player typed', () => {
    const html = buildCoachSheet(input({
      coachName: '<script>coach</script>',
      playerHandle: '<script>player</script>',
      focusItems: [{ text: '<script>focus</script>' }],
      notes: [noteOf({ text: 'plain', extraTags: ['<script>tag</script>'] })],
    }), CSS)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('names the replay so the player knows which match this is', () => {
    const html = buildCoachSheet(input({ notes: [noteOf()] }), CSS)
    expect(html).toContain('A1B2C3')
  })

  it('lists focus items in the order the coach put them', () => {
    const html = buildCoachSheet(input({
      focusItems: [{ text: 'first thing' }, { text: 'second thing' }],
    }), CSS)
    expect(html.indexOf('first thing')).toBeLessThan(html.indexOf('second thing'))
    expect(html.indexOf('first thing')).toBeGreaterThan(-1)
  })

  it('omits the focus section entirely when there is nothing to work on', () => {
    const html = buildCoachSheet(input(), CSS)
    expect(html).not.toContain('What to work on')
  })

  // A coach may end a session having written only the focus list, and a
  // reviewed-only note is a match they watched and had nothing to say about.
  it('stands up with no notes at all', () => {
    const html = buildCoachSheet(input({ focusItems: [{ text: 'ult timing' }] }), CSS)
    expect(html).toContain('ult timing')
    expect(html).toContain('<!doctype html>')
  })

  it('renders a note whose match the coach never described', () => {
    const html = buildCoachSheet(input({ notes: [noteOf({ match: null })] }), CSS)
    expect(html).toContain('Hold the high ground.')
    expect(html).toContain('replay-A1B2C3')
  })

  it('renders a moment at its clock', () => {
    const html = buildCoachSheet(input({
      notes: [noteOf({ moments: [{ matchClock: '02:30', text: 'ult here' }] })],
    }), CSS)
    expect(html).toContain('02:30')
    expect(html).toContain('ult here')
  })
})

describe('toSheetInput — folding the session into the document', () => {
  const src = {
    coachName: 'Ordo',
    playerHandle: 'Sable',
    sessionDate: '2026-08-15',
    focusItems: [{ text: 'ult timing' }],
    notes: [{
      matchKey: 'replay-A1B2C3',
      kind: 'note',
      text: 'rotate earlier',
      focusTags: ['positioning'],
      extraTags: [],
      matchClock: '04:12',
    }],
    records: [{
      match_key: 'replay-A1B2C3',
      data: { map: 'ilios', hero: 'ana', result: 'defeat', date: '2026-08-15' },
      annotation: { replay_code: 'A1B2C3' },
    }],
    momentsByKey: { 'replay-A1B2C3': [{ matchClock: '02:30', text: 'ult here' }] },
  }

  it('joins each note to the match it is about', () => {
    const out = toSheetInput(src)
    expect(out.notes[0]!.match).toEqual({
      map: 'ilios', hero: 'ana', result: 'defeat',
      date: '2026-08-15', finishedAt: '', replayCode: 'A1B2C3',
    })
    expect(out.notes[0]!.moments).toEqual([{ matchClock: '02:30', text: 'ult here' }])
  })

  // The record may be missing entirely — a note about a match that left the
  // corpus. The sheet still has to render it rather than throwing.
  it('survives a note whose match is not in the corpus', () => {
    const out = toSheetInput({ ...src, records: [] })
    expect(out.notes[0]!.match).toBeNull()
    expect(buildCoachSheet(out, CSS)).toContain('rotate earlier')
  })

  it('carries no moments for a match that has none', () => {
    const out = toSheetInput({ ...src, momentsByKey: {} })
    expect(out.notes[0]!.moments).toEqual([])
  })
})

describe('buildCoachSheet — a moment takes the same grammar as a note', () => {
  it("renders the coach's emphasis rather than shipping literal asterisks", () => {
    // This page is what the PLAYER opens. A note beside it renders markdown,
    // so a moment that did not would arrive looking like a typo.
    const html = buildCoachSheet(input({
      notes: [noteOf({ moments: [{ matchClock: '02:30', text: '**do not** peek there' }] })],
    }), CSS)
    expect(html).toContain('<strong>do not</strong> peek there')
    expect(html).not.toContain('**do not**')
  })

  it('escapes a moment before it emphasizes it', () => {
    const html = buildCoachSheet(input({
      notes: [noteOf({ moments: [{ matchClock: '02:30', text: '<script>x</script>' }] })],
    }), CSS)
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('keeps a caption from growing block structure inside its row', () => {
    // The moment renders inside a <li> beside its clock; a <p> or a nested
    // <ul> there would be markup the row was never shaped for.
    const html = buildCoachSheet(input({
      notes: [noteOf({ moments: [{ matchClock: '02:30', text: '- not a list' }] })],
    }), CSS)
    expect(html).toContain('- not a list')
    expect(html).not.toContain('<ul><li>not a list')
  })
})
