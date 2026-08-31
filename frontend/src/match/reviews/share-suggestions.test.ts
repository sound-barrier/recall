import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api-client'
import { shareSuggestions, SUGGESTION_LIMIT } from '@/match/reviews/share-suggestions'

interface RecOpts {
  key: string
  date: string
  result?: string
  hero?: string
  map?: string
  code?: string
  hidden?: boolean
}

function rec(o: RecOpts): MatchRecord {
  return {
    match_key: o.key,
    source_files: [`${o.key}.png`],
    data: {
      hero: o.hero ?? 'ana',
      map: o.map ?? 'rialto',
      result: o.result ?? 'defeat',
      date: o.date,
      finished_at: '20:00',
    },
    ...(o.code === undefined ? {} : { annotation: { leavers: [], throwers: [], replay_code: o.code } }),
    ...(o.hidden ? { hidden: true } : {}),
  } as unknown as MatchRecord
}

// The vocabulary the roster knows, as the composable supplies it.
const NAMES = { heroes: ['ana', 'juno', 'kiriko'], maps: ['rialto', "king's row", 'busan'] }

describe('shareSuggestions', () => {
  const corpus = [
    rec({ key: 'a', date: '2026-05-01', result: 'defeat', hero: 'ana', code: 'AAA111' }),
    rec({ key: 'b', date: '2026-05-02', result: 'victory', hero: 'ana', code: 'BBB222' }),
    rec({ key: 'c', date: '2026-05-03', result: 'defeat', hero: 'juno', code: 'CCC333' }),
    rec({ key: 'd', date: '2026-05-04', result: 'defeat', hero: 'ana', code: 'DDD444' }),
  ]

  // A suggestion that lands the user in the dialog's own refusal — "N of
  // these have no replay code" — is worse than no suggestion: it costs a
  // click and teaches them the button is broken.
  it('never suggests a match a coach could not load', () => {
    const withGap = [...corpus, rec({ key: 'gap', date: '2026-05-05', result: 'defeat' })]
    const [since] = shareSuggestions({
      records: withGap, alreadySent: [], focusText: [], names: NAMES,
    })
    expect(since?.keys).not.toContain('gap')
  })

  // The bundle carries these matches WHOLE — screenshots, journal notes,
  // tags, BattleTags. Every other door into the dialog resolves its keys
  // from the narrowed set, which drops hidden records; a suggestion reads
  // the raw corpus, so it is the one door that could put a match the user
  // soft-deleted in front of a coach.
  it('never suggests a match the user hid', () => {
    const withHidden = [...corpus, rec({
      key: 'hid', date: '2026-05-06', result: 'defeat', code: 'HID111', hidden: true,
    })]
    const [since] = shareSuggestions({
      records: withHidden, alreadySent: [], focusText: [], names: NAMES,
    })
    expect(since?.keys).not.toContain('hid')
  })

  describe('everything since the last send', () => {
    it('offers what has not gone out yet, newest first', () => {
      const [since] = shareSuggestions({
        records: corpus, alreadySent: ['a', 'b'], focusText: [], names: NAMES,
      })
      expect(since?.keys).toEqual(['d', 'c'])
    })

    it('is absent when everything has already been sent', () => {
      const out = shareSuggestions({
        records: corpus, alreadySent: ['a', 'b', 'c', 'd'], focusText: [], names: NAMES,
      })
      expect(out.find((s) => s.id === 'since-last-send')).toBeUndefined()
    })
  })

  describe('recent losses on what you are working on', () => {
    // The focus item stores no hero and no map — it is a sentence the coach
    // or the player wrote. Reading the names out of that sentence is what
    // ties the two together without a schema change.
    it('reads canonical hero and map names out of the item text', () => {
      const out = shareSuggestions({
        records: corpus,
        alreadySent: [],
        focusText: ['Hold high ground longer on Ana before committing'],
        names: NAMES,
      })
      const focus = out.find((s) => s.id === 'focus-losses')
      // Ana losses only — the win is not what you review, and Juno is not
      // what you are working on.
      expect(focus?.keys).toEqual(['d', 'a'])
    })

    it('matches a map name too', () => {
      const withMaps = [
        rec({ key: 'kr', date: '2026-05-06', result: 'defeat', map: "king's row", code: 'KKK111' }),
        rec({ key: 'bu', date: '2026-05-07', result: 'defeat', map: 'busan', code: 'BUS111' }),
      ]
      const out = shareSuggestions({
        records: withMaps, alreadySent: [], focusText: ["First point on King's Row"], names: NAMES,
      })
      expect(out.find((s) => s.id === 'focus-losses')?.keys).toEqual(['kr'])
    })

    // A name that happens to sit inside a longer word is not a name.
    // "analysis" contains "ana", and a focus item saying to do one is not a
    // focus item about the hero. Chosen because the naive substring version
    // of this rule passes every other case in this file.
    it('does not match a name buried in another word', () => {
      const out = shareSuggestions({
        records: corpus, alreadySent: [], focusText: ['Do a quick analysis before you queue'], names: NAMES,
      })
      expect(out.find((s) => s.id === 'focus-losses')).toBeUndefined()
    })

    it('is absent when no open item names anything the roster knows', () => {
      const out = shareSuggestions({
        records: corpus, alreadySent: [], focusText: ['Warm up before you queue'], names: NAMES,
      })
      expect(out.find((s) => s.id === 'focus-losses')).toBeUndefined()
    })
  })

  // A suggestion is a starting point the user edits, not a bulk export.
  it('caps each suggestion so the dialog stays reviewable', () => {
    const many = Array.from({ length: SUGGESTION_LIMIT + 5 }, (_, i) =>
      rec({ key: `m${i}`, date: `2026-05-${String(i + 1).padStart(2, '0')}`, code: `C${i}` }))
    const [since] = shareSuggestions({
      records: many, alreadySent: [], focusText: [], names: NAMES,
    })
    expect(since?.keys).toHaveLength(SUGGESTION_LIMIT)
  })
})
