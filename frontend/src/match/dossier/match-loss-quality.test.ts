import { describe, it, expect } from 'vitest'

import { lossQuality } from '@/match/dossier/match-loss-quality'

describe('lossQuality', () => {
  it('classifies a one-point margin as close', () => {
    expect(lossQuality('defeat', '2-3')).toBe('close')
    expect(lossQuality('defeat', '1-2')).toBe('close')
    expect(lossQuality('defeat', '4-5')).toBe('close')
  })

  it('classifies a shutout as a stomp regardless of margin', () => {
    expect(lossQuality('defeat', '0-2')).toBe('stomp')
    expect(lossQuality('defeat', '0-1')).toBe('stomp')
  })

  it('classifies a margin of three or more as a stomp', () => {
    expect(lossQuality('defeat', '1-4')).toBe('stomp')
    expect(lossQuality('defeat', '2-5')).toBe('stomp')
  })

  it('classifies the in-between margins as normal', () => {
    expect(lossQuality('defeat', '1-3')).toBe('normal')
    expect(lossQuality('defeat', '2-4')).toBe('normal')
  })

  it('is orientation-agnostic — OCR may put the loser first or second', () => {
    expect(lossQuality('defeat', '3-2')).toBe('close')
    expect(lossQuality('defeat', '4-1')).toBe('stomp')
  })

  it('never classifies victories or draws', () => {
    expect(lossQuality('victory', '0-3')).toBeNull()
    expect(lossQuality('draw', '2-2')).toBeNull()
    expect(lossQuality(undefined, '2-3')).toBeNull()
  })

  it('returns null for missing or unparseable scores', () => {
    expect(lossQuality('defeat', undefined)).toBeNull()
    expect(lossQuality('defeat', '')).toBeNull()
    expect(lossQuality('defeat', 'abc')).toBeNull()
    expect(lossQuality('defeat', '76.02m')).toBeNull() // push distance
  })

  it('tolerates spaced score separators', () => {
    expect(lossQuality('defeat', '2 - 3')).toBe('close')
  })
})
