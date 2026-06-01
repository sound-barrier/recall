import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { useScreenshotPreview } from './useScreenshotPreview'

describe('useScreenshotPreview — inline expand', () => {
  it('togglePreview flips per-filename state and clears any prior error', () => {
    const p = useScreenshotPreview()
    expect(p.isPreviewOpen('a.png')).toBe(false)
    p.togglePreview('a.png')
    expect(p.isPreviewOpen('a.png')).toBe(true)
    p.onPreviewError('a.png')
    expect(p.hasPreviewError('a.png')).toBe(true)
    // Re-opening clears the stale error so a transient 404 doesn't
    // wedge the user out of trying again.
    p.togglePreview('a.png')
    p.togglePreview('a.png')
    expect(p.hasPreviewError('a.png')).toBe(false)
  })

  it('each filename has independent state', () => {
    const p = useScreenshotPreview()
    p.togglePreview('a.png')
    expect(p.isPreviewOpen('a.png')).toBe(true)
    expect(p.isPreviewOpen('b.png')).toBe(false)
  })
})

describe('useScreenshotPreview — lightbox', () => {
  it('openLightbox snapshots files and dirIDs', () => {
    const p = useScreenshotPreview()
    p.openLightbox('b.png', ['a.png', 'b.png', 'c.png'], { 'b.png': 7 })
    expect(p.lightboxFilename.value).toBe('b.png')
    expect(p.lightboxFiles.value).toEqual(['a.png', 'b.png', 'c.png'])
    expect(p.lightboxDirIDs.value['b.png']).toBe(7)
    expect(p.lightboxIndex.value).toBe(1)
  })

  it('lightboxPrev/Next walk the snapshot without falling off the ends', () => {
    const p = useScreenshotPreview()
    p.openLightbox('b.png', ['a.png', 'b.png', 'c.png'])
    p.lightboxPrev()
    expect(p.lightboxFilename.value).toBe('a.png')
    p.lightboxPrev() // already at 0
    expect(p.lightboxFilename.value).toBe('a.png')
    p.lightboxNext()
    p.lightboxNext()
    p.lightboxNext() // already at end
    expect(p.lightboxFilename.value).toBe('c.png')
  })

  it('closeLightbox resets state', () => {
    const p = useScreenshotPreview()
    p.openLightbox('a.png', ['a.png', 'b.png'])
    p.closeLightbox()
    expect(p.lightboxFilename.value).toBeNull()
    expect(p.lightboxFiles.value).toEqual([])
  })

  it('openLightbox without an explicit files arg defaults to the single filename', () => {
    const p = useScreenshotPreview()
    p.openLightbox('only.png')
    expect(p.lightboxFiles.value).toEqual(['only.png'])
  })
})

describe('useScreenshotPreview — preload', () => {
  let imgs: { src: string }[] = []
  let ImageOriginal: typeof Image
  beforeEach(() => {
    imgs = []
    ImageOriginal = globalThis.Image
    // `new Image()` needs a constructable on the RHS. Stub with a
    // class so every instantiation pushes its `src`-bearing instance
    // onto the captured list.
    class FakeImage {
      src = ''
      constructor() {
        imgs.push(this)
      }
    }
    globalThis.Image = FakeImage as unknown as typeof Image
  })
  afterEach(() => {
    globalThis.Image = ImageOriginal
  })

  it('preload issues one request per distinct URL', () => {
    const p = useScreenshotPreview()
    p.preload('/_screenshot/a.png')
    p.preload('/_screenshot/a.png') // dedupe
    p.preload('/_screenshot/b.png')
    expect(imgs.map((i) => i.src)).toEqual([
      '/_screenshot/a.png',
      '/_screenshot/b.png',
    ])
  })

  it('preload ignores empty URLs', () => {
    const p = useScreenshotPreview()
    p.preload('')
    expect(imgs).toHaveLength(0)
  })
})

