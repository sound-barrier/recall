import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  isReplayCode,
  normalizeReplayCode,
  REPLAY_CODE_LENGTH,
  toReplayCodeDraft,
} from '@/match/replay-code'

// The SHARED table, read straight from where the Go validator reads it. Two
// implementations of one rule only stay honest if a single fixture pins them,
// and this rule is worse than most to get wrong: it decides a match key, so a
// divergence produces a note that lands nowhere and reports nothing. A case
// added to the file fails whichever side has not caught up.
const FIXTURE = resolve(__dirname, '../../../pkg/match/testdata/replay_code_cases.json')
const cases = (
  JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    cases: { name: string; in: string; want: string; ok: boolean }[]
  }
).cases

describe('normalizeReplayCode — the shared identity rule', () => {
  it('has cases to run', () => {
    expect(cases.length).toBeGreaterThan(15)
  })

  it.each(cases.map((c) => [c.name, c.in, c.want, c.ok] as const))(
    '%s', (_name, input, want, ok) => {
      expect(normalizeReplayCode(input)).toBe(ok ? want : null)
      expect(isReplayCode(input)).toBe(ok)
    },
  )

  it('is idempotent, which the store startup pass depends on', () => {
    for (const c of cases.filter((x) => x.ok)) {
      expect(normalizeReplayCode(c.want)).toBe(c.want)
    }
  })
})

describe('toReplayCodeDraft — the field as it is being typed', () => {
  it('uppercases without waiting for the code to be complete', () => {
    expect(toReplayCodeDraft('a1b')).toBe('A1B')
  })

  it('stops at six so the field cannot hold what the server would refuse', () => {
    expect(toReplayCodeDraft('a1b2c3d4e5')).toBe('A1B2C3')
  })

  it('drops characters a replay code can never contain', () => {
    expect(toReplayCodeDraft('a1b2-c3d4')).toBe('A1B2C3')
    expect(toReplayCodeDraft('  A1 B2 C3  ')).toBe('A1B2C3')
  })

  it('leaves an empty field empty rather than inventing a code', () => {
    expect(toReplayCodeDraft('')).toBe('')
    expect(toReplayCodeDraft('---')).toBe('')
  })

  // The two functions have to agree: anything the draft helper produces at
  // full length is a code the validator accepts, or the field would show
  // something the server rejects.
  it('produces a code the validator accepts once it is six long', () => {
    const draft = toReplayCodeDraft('a1b2c3extra')
    expect(draft).toHaveLength(REPLAY_CODE_LENGTH)
    expect(normalizeReplayCode(draft)).toBe(draft)
  })
})
