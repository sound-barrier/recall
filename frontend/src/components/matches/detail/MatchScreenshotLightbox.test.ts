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

// Keyboard navigation runs on a CAPTURE-phase document keydown listener
// so the lightbox absorbs the keys before the detail panel underneath
// reacts (otherwise ← inside the lightbox walks to the previous *match*).
// happy-dom does dispatch to capture-phase document listeners, so the
// whole contract — including the stopImmediatePropagation that keeps one
// Esc from closing both stacked modals — is pinned here; the e2e spec
// `lightbox-screenshot-navigation.spec.ts` keeps the browser-level proof.

// The panel underneath dispatches from its own subtree, so keys bubble up
// to document exactly as they do in the app.
function pressFromPanel(key: string) {
  const panel = document.createElement('div')
  document.body.appendChild(panel)
  panel.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  panel.remove()
}

describe('MatchScreenshotLightbox — keyboard navigation', () => {
  it('Escape emits close', () => {
    const { emitted } = renderLightbox({ filename: 'b.png', src: SRC, files: FILES, index: 1 })
    pressFromPanel('Escape')
    expect(emitted('close')).toBeTruthy()
  })

  it('ArrowRight and l both step forward; ArrowLeft and h both step back', () => {
    const { emitted } = renderLightbox({ filename: 'b.png', src: SRC, files: FILES, index: 1 })
    pressFromPanel('ArrowRight')
    pressFromPanel('l')
    pressFromPanel('ArrowLeft')
    pressFromPanel('h')
    expect(emitted('next')).toHaveLength(2)
    expect(emitted('prev')).toHaveLength(2)
  })

  it('is a no-op at the first screenshot — ← must not fall through to the panel', () => {
    // The boundary matters twice over: no bogus `prev`, AND the event
    // stays live so the panel's own ← handler can still walk matches.
    const { emitted } = renderLightbox({ filename: 'a.png', src: '/_screenshot/a.png', files: FILES, index: 0 })
    let reachedPanel = false
    const spy = () => { reachedPanel = true }
    document.addEventListener('keydown', spy)
    pressFromPanel('ArrowLeft')
    document.removeEventListener('keydown', spy)

    expect(emitted('prev')).toBeFalsy()
    expect(reachedPanel).toBe(true)
  })

  it('is a no-op at the last screenshot', () => {
    const { emitted } = renderLightbox({ filename: 'c.png', src: '/_screenshot/c.png', files: FILES, index: 2 })
    pressFromPanel('ArrowRight')
    expect(emitted('next')).toBeFalsy()
  })

  it('swallows a handled key so the stacked panel never sees it', () => {
    // The "one Esc closes both modals" regression: the panel's Escape is a
    // bubble-phase document listener, so the lightbox has to stop
    // immediate propagation from capture, not merely preventDefault.
    renderLightbox({ filename: 'b.png', src: SRC, files: FILES, index: 1 })
    let reachedPanel = false
    const spy = () => { reachedPanel = true }
    document.addEventListener('keydown', spy)
    pressFromPanel('Escape')
    document.removeEventListener('keydown', spy)
    expect(reachedPanel).toBe(false)
  })

  it('ignores unrelated keys entirely', () => {
    const { emitted } = renderLightbox({ filename: 'b.png', src: SRC, files: FILES, index: 1 })
    pressFromPanel('j')
    expect(emitted('next')).toBeFalsy()
    expect(emitted('prev')).toBeFalsy()
    expect(emitted('close')).toBeFalsy()
  })

  it('stops listening once the lightbox closes', async () => {
    const { emitted, rerender } = renderLightbox({ filename: 'b.png', src: SRC, files: FILES, index: 1 })
    await rerender({ filename: null, src: null, files: FILES, index: -1 })
    pressFromPanel('Escape')
    pressFromPanel('ArrowRight')
    // A surviving listener would eat every arrow key in the app for the
    // rest of the session.
    expect(emitted('close')).toBeFalsy()
    expect(emitted('next')).toBeFalsy()
  })
})

describe('MatchScreenshotLightbox — detached file (index -1)', () => {
  it('disables both arrows and suppresses the caption', () => {
    // Defensive state: the viewed file vanished from the match's list.
    // Navigation has no meaningful direction, so offer none.
    renderLightbox({ filename: 'gone.png', src: '/_screenshot/gone.png', files: FILES, index: -1 })
    expect(prevBtn()).toBeDisabled()
    expect(nextBtn()).toBeDisabled()
    expect(screen.queryByText(/of 3/)).not.toBeInTheDocument()
  })

  it('keyboard navigation is inert too', () => {
    const { emitted } = renderLightbox({ filename: 'gone.png', src: '/_screenshot/gone.png', files: FILES, index: -1 })
    pressFromPanel('ArrowRight')
    pressFromPanel('ArrowLeft')
    expect(emitted('next')).toBeFalsy()
    expect(emitted('prev')).toBeFalsy()
  })
})

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

describe('MatchScreenshotLightbox — legacy single-screenshot mount', () => {
  it('falls back to a one-file list when the caller passes no navigation props', () => {
    // Call sites that only want the enlarged view (Unknown-tab source rows)
    // omit files/index; the lightbox must not offer navigation it cannot do.
    render(MatchScreenshotLightbox, { props: { filename: 'a.png', src: SRC } })
    expect(prevBtn()).toBeDisabled()
    expect(nextBtn()).toBeDisabled()
    expect(screen.queryByText(/of 1/)).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'a.png' })).toBeInTheDocument()
  })
})
