import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'

import MatchScreenshotLightbox from '@/components/matches/detail/MatchScreenshotLightbox.vue'

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

function renderLightbox(props: {
  filename: string | null
  src: string | null
  files: string[]
  index: number
}) {
  return render(MatchScreenshotLightbox, { props })
}

const FILES = ['a.png', 'b.png', 'c.png']
const SRC   = '/_screenshot/b.png'

const prevBtn = () => screen.getByRole('button', { name: 'Previous screenshot in this match' })
const nextBtn = () => screen.getByRole('button', { name: 'Next screenshot in this match' })

describe('MatchScreenshotLightbox — prev/next buttons', () => {
  it('renders < and > buttons with the literal arrow glyphs', () => {
    renderLightbox({ filename: 'b.png', src: SRC, files: FILES, index: 1 })
    expect(prevBtn()).toHaveTextContent('<')
    expect(nextBtn()).toHaveTextContent('>')
  })

  it('emits "prev" when the < button is clicked at a navigable position', async () => {
    const user = userEvent.setup()
    const { emitted } = renderLightbox({ filename: 'b.png', src: SRC, files: FILES, index: 1 })
    await user.click(prevBtn())
    expect(emitted('prev')).toBeTruthy()
    expect(emitted('next')).toBeFalsy()
  })

  it('emits "next" when the > button is clicked at a navigable position', async () => {
    const user = userEvent.setup()
    const { emitted } = renderLightbox({ filename: 'b.png', src: SRC, files: FILES, index: 1 })
    await user.click(nextBtn())
    expect(emitted('next')).toBeTruthy()
    expect(emitted('prev')).toBeFalsy()
  })

  it('disables the < button at index 0 (boundary) and clicking it is a no-op', async () => {
    const user = userEvent.setup()
    const { emitted } = renderLightbox({ filename: 'a.png', src: '/_screenshot/a.png', files: FILES, index: 0 })
    expect(prevBtn()).toBeDisabled()
    await user.click(prevBtn())
    expect(emitted('prev')).toBeFalsy()
  })

  it('disables the > button at the last index and clicking it is a no-op', async () => {
    const user = userEvent.setup()
    const { emitted } = renderLightbox({ filename: 'c.png', src: '/_screenshot/c.png', files: FILES, index: 2 })
    expect(nextBtn()).toBeDisabled()
    await user.click(nextBtn())
    expect(emitted('next')).toBeFalsy()
  })

  it('disables BOTH arrow buttons when files has length 1', () => {
    renderLightbox({ filename: 'a.png', src: '/_screenshot/a.png', files: ['a.png'], index: 0 })
    expect(prevBtn()).toBeDisabled()
    expect(nextBtn()).toBeDisabled()
  })
})

describe('MatchScreenshotLightbox — "N of M" caption', () => {
  it('renders "i+1 of files.length" when files.length > 1', () => {
    renderLightbox({ filename: 'b.png', src: SRC, files: FILES, index: 1 })
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
  })

  it('updates the caption as the index prop changes', async () => {
    const { rerender } = renderLightbox({ filename: 'a.png', src: '/_screenshot/a.png', files: FILES, index: 0 })
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    await rerender({ filename: 'c.png', src: '/_screenshot/c.png', files: FILES, index: 2 })
    expect(screen.getByText('3 of 3')).toBeInTheDocument()
  })

  it('suppresses the caption when files.length === 1 — no "1 of 1" noise', () => {
    renderLightbox({ filename: 'a.png', src: '/_screenshot/a.png', files: ['a.png'], index: 0 })
    expect(screen.queryByText('1 of 1')).not.toBeInTheDocument()
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
    renderLightbox({ filename: null, src: null, files: [], index: -1 })
    // Sanity: the dialog doesn't exist while filename is null.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('emits "close" when the × button is clicked', async () => {
    const user = userEvent.setup()
    const { emitted } = renderLightbox({ filename: 'a.png', src: SRC, files: FILES, index: 1 })
    await user.click(screen.getByRole('button', { name: 'Close screenshot preview' }))
    expect(emitted('close')).toBeTruthy()
  })

  it('emits "close" when the backdrop (not the image) is clicked', async () => {
    const user = userEvent.setup()
    const { emitted } = renderLightbox({ filename: 'a.png', src: SRC, files: FILES, index: 1 })
    // Backdrop clicks use `@click.self` so only events whose target IS
    // the backdrop element trigger close. user.click(dialog) dispatches
    // on the dialog element itself, which satisfies that.
    await user.click(screen.getByRole('dialog'))
    expect(emitted('close')).toBeTruthy()
  })

  it('does NOT emit "close" when the image is clicked', async () => {
    const user = userEvent.setup()
    const { emitted } = renderLightbox({ filename: 'a.png', src: SRC, files: FILES, index: 1 })
    await user.click(screen.getByRole('img', { name: 'a.png' }))
    expect(emitted('close')).toBeFalsy()
  })
})
