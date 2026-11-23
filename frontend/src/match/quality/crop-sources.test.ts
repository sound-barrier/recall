import { describe, expect, it } from 'vitest'

import type { FieldRegion, MatchRecord } from '@/api'
import { captionedCrops, cropCaption } from '@/match/quality/crop-sources'

const rec = { source_types: { 'summary.png': 'summary', 'teams.png': 'teams' } } as Pick<MatchRecord, 'source_types'>
const flag = {
  readings: [
    { source_file: 'summary.png', origin: 'ocr' as const, value: '74' },
    { source_file: 'summary.png', origin: 'derived' as const, value: '9' },
    { source_file: 'teams.png', origin: 'ocr' as const, value: '9' },
    { source_file: 'teams.png', origin: 'template' as const, value: '8' },
  ],
}

describe('cropCaption', () => {
  it('names the screen a crop was cut from', () => {
    expect(cropCaption(rec, 'summary.png', null)).toBe('SUMMARY')
    expect(cropCaption(rec, 'teams.png', null)).toBe('TEAMS')
  })

  it('falls back to the file for a screen of no known type', () => {
    expect(cropCaption(rec, 'other.png', null)).toBe('other.png')
  })

  // A reading worked out from a screen was not read at the crop's pixels.
  it('adds what a flagged field read on those pixels', () => {
    expect(cropCaption(rec, 'summary.png', flag)).toBe('SUMMARY · read 74')
    expect(cropCaption(rec, 'teams.png', flag)).toBe('TEAMS · read 9 or 8')
  })
})

describe('captionedCrops', () => {
  const region = (field: string, file: string): FieldRegion => ({
    source_file: file, dir_id: 0, field,
    x: 400, y: 300, width: 80, height: 40, image_width: 1920, image_height: 1080,
  })

  it("keeps only the field's own regions, each captioned with its screen", () => {
    const regions = [region('data.eliminations', 'summary.png'), region('data.damage', 'summary.png'),
      region('data.eliminations', 'teams.png')]

    expect(captionedCrops(rec, regions, 'data.eliminations', flag).map((c) => [c.region.source_file, c.caption]))
      .toEqual([['summary.png', 'SUMMARY · read 74'], ['teams.png', 'TEAMS · read 9 or 8']])
  })
})
