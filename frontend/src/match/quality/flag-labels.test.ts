import { describe, expect, it } from 'vitest'

import type { MatchRecord } from '@/api'
import { CHECK_LABEL, fieldLabel, readingSource } from '@/match/quality/flag-labels'

const heroes = { heroes_played: [{ hero: 'd.va' }], sr: [{ hero: 'soldier 76', sr: 2500 }] } as MatchRecord['data']

describe('fieldLabel', () => {
  it.each([
    ['data.eliminations', 'Eliminations'],
    ['data.rank_progress', 'Rank progress'],
    ['data.heroes_played', 'Heroes played'],
    // Hero keys are matched whole: "d.va" holds the "." paths split on.
    ['data.heroes_played.d.va.percent_played', 'd.va share of play'],
    ['data.heroes_played.d.va', 'Hero on the d.va card'],
    ['data.sr.soldier 76.sr', 'soldier 76 SR'],
    ['data.sr.soldier 76', 'Hero on the soldier 76 rank card'],
    ['data.heroes_played.d.va.stats.self_destruct_kills', 'd.va self destruct kills'],
  ])('names %s as %s', (path, label) => {
    expect(fieldLabel(path, heroes)).toBe(label)
  })

  it('falls back to the path for a field it has no words for', () => {
    expect(fieldLabel('data.something_new.x', heroes)).toBe('data.something_new.x')
  })
})

describe('readingSource', () => {
  it('says how each reading was made and from which screenshot', () => {
    expect(readingSource({ source_file: 'a.png', origin: 'ocr', value: '74' })).toBe('read by OCR from a.png')
    expect(readingSource({ source_file: 'a.png', origin: 'derived', value: '9' })).toBe('worked out from a.png')
    expect(readingSource({ source_file: 'a.png', origin: 'template', value: '9' })).toBe('matched by the reference templates on a.png')
  })
})

describe('CHECK_LABEL', () => {
  it('explains every check in words', () => {
    for (const label of Object.values(CHECK_LABEL)) expect(label).toMatch(/^[A-Z].+\.$/)
  })
})
