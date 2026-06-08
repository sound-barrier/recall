import { describe, it, expect } from 'vitest'
import { summaryThumbnailURL } from './useSummaryThumbnail'

describe('summaryThumbnailURL', () => {
  it('returns null when source_files is missing or empty', () => {
    expect(summaryThumbnailURL({} as never)).toBeNull()
    expect(summaryThumbnailURL({ source_files: [] } as never)).toBeNull()
  })

  it('prefers a SUMMARY-classified file over later sources', () => {
    const rec = {
      source_files: ['a.png', 'b.png', 'c.png'],
      source_types: { 'a.png': 'scoreboard', 'b.png': 'summary', 'c.png': 'personal' },
      source_dir_ids: { 'a.png': 1, 'b.png': 2, 'c.png': 3 },
    }
    expect(summaryThumbnailURL(rec as never)).toBe('/_screenshot/2/b.png')
  })

  it('falls back to SCOREBOARD when no SUMMARY exists', () => {
    const rec = {
      source_files: ['a.png', 'b.png'],
      source_types: { 'a.png': 'personal', 'b.png': 'scoreboard' },
      source_dir_ids: { 'a.png': 1, 'b.png': 2 },
    }
    expect(summaryThumbnailURL(rec as never)).toBe('/_screenshot/2/b.png')
  })

  it('falls back to the first source file when nothing is classified', () => {
    const rec = {
      source_files: ['x.png', 'y.png'],
      source_types: {},
      source_dir_ids: { 'x.png': 7 },
    }
    expect(summaryThumbnailURL(rec as never)).toBe('/_screenshot/7/x.png')
  })

  it('defaults dir-id to 0 when source_dir_ids is missing the file', () => {
    const rec = { source_files: ['only.png'] }
    expect(summaryThumbnailURL(rec as never)).toBe('/_screenshot/0/only.png')
  })
})
