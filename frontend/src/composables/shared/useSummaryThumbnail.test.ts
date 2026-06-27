import { describe, it, expect } from 'vitest'
import { summaryThumbnailURL } from '@/composables/shared/useSummaryThumbnail'

describe('summaryThumbnailURL', () => {
  it('returns null when there is no on-disk thumbnail file', () => {
    // No thumbnail_file at all (manual match / data-only import / deleted file).
    expect(summaryThumbnailURL({} as never)).toBeNull()
    expect(summaryThumbnailURL({ thumbnail_file: '' } as never)).toBeNull()
    // Source files exist but none resolved to a real image on disk.
    expect(summaryThumbnailURL({ source_dir_ids: { 'a.png': 2 } } as never)).toBeNull()
  })

  it('builds the URL from the server-chosen thumbnail_file + its dir-id', () => {
    const rec = {
      thumbnail_file: 'b.png',
      source_dir_ids: { 'a.png': 1, 'b.png': 2, 'c.png': 3 },
    }
    expect(summaryThumbnailURL(rec as never)).toBe('/_screenshot/2/b.png')
  })

  it('defaults dir-id to 0 when source_dir_ids is missing the file', () => {
    const rec = { thumbnail_file: 'only.png' }
    expect(summaryThumbnailURL(rec as never)).toBe('/_screenshot/0/only.png')
  })
})
