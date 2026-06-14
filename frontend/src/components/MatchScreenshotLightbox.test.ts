import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

import MatchScreenshotLightbox from '@/components/MatchScreenshotLightbox.vue'

// Lightbox prev/next contract.
//
// The component is the visual anchor for "navigate between the
// screenshots of the same match without leaving the enlarged view."
// It accepts `filename` + `files` + `index` as props and emits
// `prev` / `next` when the user clicks the < / > buttons or
// presses ArrowLeft/h / ArrowRight/l. The parent (App.vue) owns
// the array, so the lightbox just reports intent — no array
// arithmetic happens here.
//
// Why a unit spec on top of the Playwright e2e: keyboard handling
// runs in document-capture and the canPrev/canNext gating is
// purely derived from props. Vitest exercises both fast without
// the e2e's browser overhead, so a regression that changes the
// emit shape (or accidentally fires `next` at the boundary)
// surfaces at the unit layer first.

function mountLightbox(props: {
  filename: string | null
  src: string | null
  files: string[]
  index: number
}) {
  return mount(MatchScreenshotLightbox, { props, attachTo: document.body })
}

const FILES = ['a.png', 'b.png', 'c.png']
const SRC   = '/_screenshot/b.png'

describe('MatchScreenshotLightbox — prev/next buttons', () => {
  it('renders < and > buttons with the literal arrow glyphs', () => {
    const w = mountLightbox({ filename: 'b.png', src: SRC, files: FILES, index: 1 })
    const prev = w.find('.lightbox-prev')
    const next = w.find('.lightbox-next')
    expect(prev.exists()).toBe(true)
    expect(next.exists()).toBe(true)
    expect(prev.text()).toContain('<')
    expect(next.text()).toContain('>')
  })

  it('emits "prev" when the < button is clicked at a navigable position', async () => {
    const w = mountLightbox({ filename: 'b.png', src: SRC, files: FILES, index: 1 })
    await w.find('.lightbox-prev').trigger('click')
    expect(w.emitted('prev')).toBeTruthy()
    expect(w.emitted('next')).toBeFalsy()
  })

  it('emits "next" when the > button is clicked at a navigable position', async () => {
    const w = mountLightbox({ filename: 'b.png', src: SRC, files: FILES, index: 1 })
    await w.find('.lightbox-next').trigger('click')
    expect(w.emitted('next')).toBeTruthy()
    expect(w.emitted('prev')).toBeFalsy()
  })

  it('disables the < button at index 0 (boundary) and clicking it is a no-op', async () => {
    const w = mountLightbox({ filename: 'a.png', src: '/_screenshot/a.png', files: FILES, index: 0 })
    const prev = w.find('.lightbox-prev')
    expect(prev.attributes('disabled')).toBeDefined()
    await prev.trigger('click')
    expect(w.emitted('prev')).toBeFalsy()
  })

  it('disables the > button at the last index and clicking it is a no-op', async () => {
    const w = mountLightbox({ filename: 'c.png', src: '/_screenshot/c.png', files: FILES, index: 2 })
    const next = w.find('.lightbox-next')
    expect(next.attributes('disabled')).toBeDefined()
    await next.trigger('click')
    expect(w.emitted('next')).toBeFalsy()
  })

  it('disables BOTH arrow buttons when files has length 1', () => {
    const w = mountLightbox({ filename: 'a.png', src: '/_screenshot/a.png', files: ['a.png'], index: 0 })
    expect(w.find('.lightbox-prev').attributes('disabled')).toBeDefined()
    expect(w.find('.lightbox-next').attributes('disabled')).toBeDefined()
  })
})

describe('MatchScreenshotLightbox — "N of M" caption', () => {
  it('renders "i+1 of files.length" when files.length > 1', () => {
    const w = mountLightbox({ filename: 'b.png', src: SRC, files: FILES, index: 1 })
    expect(w.find('.lightbox-count').exists()).toBe(true)
    expect(w.find('.lightbox-count').text()).toBe('2 of 3')
  })

  it('updates the caption as the index prop changes', async () => {
    const w = mountLightbox({ filename: 'a.png', src: '/_screenshot/a.png', files: FILES, index: 0 })
    expect(w.find('.lightbox-count').text()).toBe('1 of 3')
    await w.setProps({ filename: 'c.png', src: '/_screenshot/c.png', files: FILES, index: 2 })
    expect(w.find('.lightbox-count').text()).toBe('3 of 3')
  })

  it('suppresses the caption when files.length === 1 — no "1 of 1" noise', () => {
    const w = mountLightbox({ filename: 'a.png', src: '/_screenshot/a.png', files: ['a.png'], index: 0 })
    expect(w.find('.lightbox-count').exists()).toBe(false)
  })
})

// Keyboard navigation (ArrowLeft / ArrowRight / h / l / Escape) is
// implemented via a capture-phase document keydown listener. happy-
// dom doesn't reliably propagate to capture-phase document listeners
// from synthesized KeyboardEvents, so the keyboard contract is
// covered by `frontend/tests/e2e/lightbox-screenshot-navigation.spec.ts`
// (real Chromium) instead of here. The button-click + caption pins
// above cover everything else the component owns.

// ── Lifecycle + emit-shape contracts (item 6 coverage lift) ──────────
describe('MatchScreenshotLightbox — open/close lifecycle', () => {
  it('renders nothing when filename is null', () => {
    const w = mountLightbox({ filename: null, src: null, files: [], index: -1 })
    // Sanity: the backdrop element doesn't exist while filename is null.
    expect(w.find('.lightbox-backdrop').exists()).toBe(false)
  })

  it('emits "close" when the × button is clicked', async () => {
    const w = mountLightbox({ filename: 'a.png', src: SRC, files: FILES, index: 1 })
    const close = w.find('.lightbox-close')
    expect(close.exists()).toBe(true)
    await close.trigger('click')
    expect(w.emitted('close')).toBeTruthy()
  })

  it('emits "close" when the backdrop (not the image) is clicked', async () => {
    const w = mountLightbox({ filename: 'a.png', src: SRC, files: FILES, index: 1 })
    // Backdrop clicks use `@click.self` so only events whose target IS
    // the backdrop element trigger close. trigger('click') without
    // overriding target satisfies that — the dispatch target IS the
    // root element.
    await w.find('.lightbox-backdrop').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
  })

  it('does NOT emit "close" when the image is clicked', async () => {
    const w = mountLightbox({ filename: 'a.png', src: SRC, files: FILES, index: 1 })
    const img = w.find('.lightbox-img')
    if (img.exists()) {
      await img.trigger('click')
      expect(w.emitted('close')).toBeFalsy()
    }
  })
})
