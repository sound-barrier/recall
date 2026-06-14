import { describe, it, expect } from 'vitest'
import {
  formatPlayModeLabel,
  formatQueueTypeLabel,
  formatUnknownHeroLabel,
  formatUnknownMapLabel,
} from '@/match-label-helpers'
import { isHeroUnknown, isMapUnknown } from '@/match-helpers'

// ─── formatPlayModeLabel / formatQueueTypeLabel ──────────────────────

describe('formatPlayModeLabel', () => {
  it('returns the override label when play_mode is set', () => {
    expect(formatPlayModeLabel({ play_mode: 'quickplay',   data: {} })).toBe('Quickplay')
    expect(formatPlayModeLabel({ play_mode: 'competitive', data: {} })).toBe('Competitive')
  })

  it('falls back to data.playlist when no override is set', () => {
    expect(formatPlayModeLabel({ data: { playlist: 'quickplay'   } })).toBe('Quickplay')
    expect(formatPlayModeLabel({ data: { playlist: 'competitive' } })).toBe('Competitive')
  })

  it('prefers the override over data.playlist when both are present', () => {
    expect(formatPlayModeLabel({
      play_mode: 'quickplay', data: { playlist: 'competitive' },
    })).toBe('Quickplay')
  })

  it('returns "Unknown mode" when nothing resolves', () => {
    expect(formatPlayModeLabel({ data: {} })).toBe('Unknown mode')
    // Empty-string mode is the closed-union sentinel for "blank" —
    // covers the case where parser wrote an empty field.
    expect(formatPlayModeLabel({ data: { playlist: '' } })).toBe('Unknown mode')
  })
})

describe('formatQueueTypeLabel', () => {
  it('returns the override label when queue_type is set', () => {
    expect(formatQueueTypeLabel({ queue_type: 'role' as const })).toBe('Role Queue')
    expect(formatQueueTypeLabel({ queue_type: 'open' as const })).toBe('Open Queue')
  })

  it('returns "Unknown mode type" when queue_type is missing', () => {
    expect(formatQueueTypeLabel({})).toBe('Unknown mode type')
  })
})

// ─── isHeroUnknown / isMapUnknown + label formatters ─────────────────
// Predicates live in match-helpers; the matching label formatters live
// here. Each pair is tested together because the leaf-row and
// detail-panel render branches read them as one unit.

describe('isHeroUnknown / formatUnknownHeroLabel', () => {
  it('hero canonical → not unknown', () => {
    expect(isHeroUnknown({ data: { hero: 'lucio' } })).toBe(false)
  })

  it('hero empty AND hero_raw set → unknown', () => {
    expect(isHeroUnknown({ data: { hero_raw: 'miyazaki' } })).toBe(true)
    expect(formatUnknownHeroLabel({ data: { hero_raw: 'miyazaki' } })).toBe('Unknown hero (miyazaki?)')
  })

  it('hero empty AND hero_raw empty → not unknown (the pre-fix case)', () => {
    expect(isHeroUnknown({ data: {} })).toBe(false)
  })

  it('hero empty but hero_raw set with no parens hint → bare label', () => {
    expect(formatUnknownHeroLabel({ data: {} })).toBe('Unknown hero')
  })
})

describe('isMapUnknown / formatUnknownMapLabel', () => {
  it('map canonical → not unknown', () => {
    expect(isMapUnknown({ data: { map: 'rialto' } })).toBe(false)
  })

  it('map empty AND map_raw set → unknown', () => {
    expect(isMapUnknown({ data: { map_raw: 'new-junk-city' } })).toBe(true)
    expect(formatUnknownMapLabel({ data: { map_raw: 'new-junk-city' } })).toBe('Unknown map (new-junk-city?)')
  })

  it('map empty AND map_raw empty → not unknown', () => {
    expect(isMapUnknown({ data: {} })).toBe(false)
  })
})
