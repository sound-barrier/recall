import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, type Ref } from 'vue'
import { fireEvent, render, screen } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'

import UnknownUnmatchedSection from '@/components/unknown/UnknownUnmatchedSection.vue'
import { useMatchesStore } from '@/stores/matches'
import { useUiStore } from '@/stores/ui'
import { IgnoreScreenshot } from '@/api'
import type { MatchRecord } from '@/api'
import type { CardStateApi } from '@/types/cardState'
import { resetWriteGate, setWritesLocked } from '@/test-utils/writeGateStub'

// Dismiss is a write and the screenshot strip goes quiet during a
// coaching session; both read the gate, stubbed here so these cases pin the
// SECTION's contract rather than the gate's.
vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))

// The Unmatched triage card: a diagnostic strip over whatever the parser
// salvaged, an expandable source/stats block, a two-click Dismiss
// with a 3 s auto-disarm, and a long-press peek for touch. The destructive
// path and the long-press guard are the two places a regression is
// expensive — an armed button that never disarms deletes a screenshot on a
// click the user made a minute later, and a long-press that also toggles
// expand makes the peek unusable.
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  GetMatchResults:       vi.fn(async () => []),
  GetNewScreenshotCount: vi.fn(async () => ({ count: 0, parked: 0 })),
  GetFailedFiles:        vi.fn(async () => []),
  GetIgnoredScreenshots: vi.fn(async () => []),
  IgnoreScreenshot:      vi.fn(async () => undefined),
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

// Minimal per-card UI state — the production bundle is owned by
// UnknownMapsView; the section only reads it through these predicates.
function makeCardState(): CardStateApi {
  const expanded = ref(new Set<string>())
  const previews = ref(new Set<string>())
  const errors = ref(new Set<string>())
  const toggle = (bag: Ref<Set<string>>, key: string) => {
    const next = new Set(bag.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    bag.value = next
  }
  return {
    isSelected:      (id) => expanded.value.has(id),
    isSourcesOpen:   () => true,
    isPreviewOpen:   (f) => previews.value.has(f),
    hasPreviewError: (f) => errors.value.has(f),
    toggleExpand:    (id) => toggle(expanded, id),
    toggleSources:   () => {},
    togglePreview:   (f) => toggle(previews, f),
    onPreviewError:  (f) => toggle(errors, f),
  }
}

function renderWith(records: MatchRecord[]) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useMatchesStore().records = records
  const cardState = makeCardState()
  const view = render(UnknownUnmatchedSection, {
    props: { cardState },
    global: { plugins: [pinia] },
  })
  return { view, cardState }
}

function unmatched(file: string, data: MatchRecord['data'] = {}, over: Partial<MatchRecord> = {}): MatchRecord {
  return { match_key: `unmatched-${file}`, source_files: [file], data, ...over }
}

// The card head is a deliberately role-less clickable container (see
// frontend/CLAUDE.md), and the cursor-anchored peek is aria-hidden
// decoration teleported to <body> — neither has an accessible query.
/* eslint-disable testing-library/no-node-access -- role-less clickable head + aria-hidden teleported thumb have no accessible-query equivalent */
const cardHead   = (idx = 0) => document.querySelectorAll('.unknown-card-head')[idx] as HTMLElement
const card       = (idx = 0) => document.querySelectorAll('.unknown-card')[idx] as HTMLElement
const hoverThumb = () => document.querySelector('.unknown-hover-thumb')
/* eslint-enable testing-library/no-node-access */

const deleteBtn = (file: string) => screen.getByRole('button', { name: `Dismiss ${file}` })
const armedBtn = (file: string) => screen.getByRole('button', { name: `Confirm dismissing ${file}` })

describe('UnknownUnmatchedSection — the card at a glance', () => {
  it('renders nothing at all when there is nothing unmatched', () => {
    renderWith([])
    expect(screen.queryByRole('article', { name: /^Unmatched screenshot / })).not.toBeInTheDocument()
  })

  it('zero-pads the running index and pluralizes the screenshot tally', () => {
    renderWith([
      unmatched('a.png'),
      { match_key: 'unmatched-multi', source_files: ['b.png', 'c.png'], data: {} },
      { match_key: 'unmatched-none', source_files: [], data: {} },
    ])
    expect(screen.getByText('01')).toBeInTheDocument()
    expect(screen.getByText('02')).toBeInTheDocument()
    expect(screen.getByText('03')).toBeInTheDocument()
    expect(screen.getByText('1 screenshot')).toBeInTheDocument()
    expect(screen.getByText('2 screenshots')).toBeInTheDocument()
    expect(screen.getByText('0 screenshots')).toBeInTheDocument()
  })

  it('composes the E/A/D diagnostic cell and dashes out the fields OCR missed', () => {
    renderWith([unmatched('a.png', { eliminations: 17, assists: 16, deaths: 11, result: 'victory' })])
    expect(screen.getByText('17 / 16 / 11')).toBeInTheDocument()
    expect(screen.getByText('victory')).toBeInTheDocument()
    // Map / Mode / Type / Date / Time / Length all parsed as nothing.
    expect(screen.getAllByText('—')).toHaveLength(6)
  })

  it('dashes the E/A/D cell out entirely when the elimination row never parsed', () => {
    renderWith([unmatched('a.png', { assists: 16, deaths: 11 })])
    expect(screen.queryByText(/ \/ 16 \/ 11/)).not.toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(8)
  })
})

describe('UnknownUnmatchedSection — expanded card', () => {
  it('lists the source files with a human parse timestamp only where one exists', async () => {
    renderWith([{
      match_key: 'unmatched-multi',
      source_files: ['a.png', 'b.png'],
      data: {},
      source_parsed_at: { 'a.png': '2026-07-06T12:00:00Z' },
    }])
    await fireEvent.click(cardHead())

    expect(screen.getByText('a.png')).toBeInTheDocument()
    expect(screen.getByText('b.png')).toBeInTheDocument()
    expect(screen.getByText(/July \d+, 2026 @ /)).toBeInTheDocument()
    expect(screen.queryByText('2026-07-06T12:00:00Z')).not.toBeInTheDocument()
  })

  it('swaps a broken preview for the check-your-folder message', async () => {
    renderWith([unmatched('a.png')])
    await fireEvent.click(cardHead())
    await fireEvent.click(screen.getByText('a.png'))

    const preview = screen.getByRole('img', { name: 'a.png' })
    expect(preview).toBeInTheDocument()

    // The screenshot went missing from the folder — the <img> errors.
    await fireEvent.error(preview)
    expect(screen.queryByRole('img', { name: 'a.png' })).not.toBeInTheDocument()
    expect(screen.getByText(/Could not load image/)).toBeInTheDocument()
  })

  it('shows the Parsed Stats block with grouped thousands and dashes for the gaps', async () => {
    renderWith([unmatched('a.png', {
      eliminations: 17, assists: 16, deaths: 11, healing: 6789,
    })])
    await fireEvent.click(cardHead())

    expect(screen.getByText('Parsed Stats')).toBeInTheDocument()
    expect(screen.getByText('17')).toBeInTheDocument()
    expect(screen.getByText('6,789')).toBeInTheDocument()
    // Damage + mitigation never parsed — both keep their slot with a dash.
    expect(screen.getByText('Damage')).toBeInTheDocument()
    expect(screen.getByText('Mitigation')).toBeInTheDocument()
  })

  it('opens the fullscreen lightbox on the whole file set, not just the clicked one', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const ui = useUiStore()
    const openLightbox = vi.spyOn(ui.preview, 'openLightbox')
    // Multi-folder corpus: each file carries the source dir it came from,
    // and the lightbox needs both so it can page between them.
    const dirIds = { 'a.png': 2, 'b.png': 2 }
    useMatchesStore().records = [{
      match_key: 'unmatched-multi', source_files: ['a.png', 'b.png'], data: {}, source_dir_ids: dirIds,
    }]
    render(UnknownUnmatchedSection, { props: { cardState: makeCardState() }, global: { plugins: [pinia] } })

    await fireEvent.click(cardHead())
    await fireEvent.click(screen.getByText('a.png'))
    await fireEvent.click(screen.getByRole('img', { name: 'a.png' }))

    expect(openLightbox).toHaveBeenCalledWith('a.png', ['a.png', 'b.png'], dirIds)
  })

  it('renders the stats block off damage alone, dashing the rows OCR missed', async () => {
    renderWith([unmatched('a.png', { damage: 9000, mitigation: 4321 })])
    await fireEvent.click(cardHead())

    expect(screen.getByText('Parsed Stats')).toBeInTheDocument()
    expect(screen.getByText('9,000')).toBeInTheDocument()
    expect(screen.getByText('4,321')).toBeInTheDocument()
    // Elims / assists / deaths / healing never parsed — four dashed stats
    // plus the eight dashed diagnostic cells above them.
    expect(screen.getAllByText('—')).toHaveLength(12)
  })

  it('omits the Parsed Stats block when neither elims nor damage survived', async () => {
    renderWith([unmatched('a.png', { assists: 4 })])
    await fireEvent.click(cardHead())
    expect(screen.queryByText('Parsed Stats')).not.toBeInTheDocument()
  })

  it('offers no source block or delete zone for a record with no files', async () => {
    renderWith([{ match_key: 'unmatched-none', source_files: [], data: {} }])
    await fireEvent.click(cardHead())
    expect(screen.queryByText('Source Files')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Dismiss/ })).not.toBeInTheDocument()
  })
})

describe('UnknownUnmatchedSection — two-click Dismiss', () => {
  it('arms on the first click and only dismisses on the second', async () => {
    renderWith([unmatched('a.png')])
    await fireEvent.click(cardHead())

    await fireEvent.click(deleteBtn('a.png'))
    const armed = armedBtn('a.png')
    expect(armed).toHaveTextContent('Confirm dismiss?')
    expect(IgnoreScreenshot).not.toHaveBeenCalled()

    await fireEvent.click(armed)
    expect(IgnoreScreenshot).toHaveBeenCalledWith('a.png')
    // Disarmed again — the button is no longer a live confirm.
    expect(deleteBtn('a.png')).toHaveTextContent('Dismiss')
  })

  it('dismisses EVERY source file a multi-screenshot card carries', async () => {
    renderWith([{ match_key: 'match-2026-05-10T22-21-11', source_files: ['a.png', 'b.png'], data: {} }])
    await fireEvent.click(cardHead())

    const btn = screen.getByRole('button', { name: 'Dismiss 2 screenshots of match-2026-05-10T22-21-11' })
    await fireEvent.click(btn)
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm dismissing 2 screenshots of match-2026-05-10T22-21-11' }))

    expect(IgnoreScreenshot).toHaveBeenNthCalledWith(1, 'a.png')
    expect(IgnoreScreenshot).toHaveBeenNthCalledWith(2, 'b.png')
  })

  it('disarms itself after the 3 s window so a stale click cannot delete', async () => {
    vi.useFakeTimers()
    renderWith([unmatched('a.png')])
    await fireEvent.click(cardHead())
    await fireEvent.click(deleteBtn('a.png'))
    expect(armedBtn('a.png')).toBeInTheDocument()

    vi.advanceTimersByTime(3000)
    await nextTick()

    expect(deleteBtn('a.png')).toHaveTextContent('Dismiss')
    // The next click re-arms rather than firing the deletion.
    await fireEvent.click(deleteBtn('a.png'))
    expect(IgnoreScreenshot).not.toHaveBeenCalled()
    expect(armedBtn('a.png')).toBeInTheDocument()
  })

  it('arms per card — a second card stays safe while the first is live', async () => {
    renderWith([unmatched('a.png'), unmatched('b.png')])
    await fireEvent.click(cardHead(0))
    await fireEvent.click(cardHead(1))

    await fireEvent.click(deleteBtn('a.png'))

    expect(armedBtn('a.png')).toBeInTheDocument()
    expect(deleteBtn('b.png')).toHaveTextContent('Dismiss')

    await fireEvent.click(deleteBtn('b.png'))
    expect(IgnoreScreenshot).not.toHaveBeenCalled()
  })
})

describe('UnknownUnmatchedSection — touch long-press peek', () => {
  const TOUCH = { pointerType: 'touch', clientX: 100, clientY: 120 }

  it('peeks after the hold and swallows the release so the card does not also expand', async () => {
    vi.useFakeTimers()
    renderWith([unmatched('a.png')])

    await fireEvent.pointerDown(card(), TOUCH)
    vi.advanceTimersByTime(500)
    await nextTick()
    expect(hoverThumb()).not.toBeNull()

    await fireEvent.pointerUp(card())
    expect(hoverThumb()).toBeNull()

    // The release that ended a peek must not toggle the card open.
    await fireEvent.click(cardHead())
    expect(screen.queryByText('Source Files')).not.toBeInTheDocument()
  })

  it('a short tap never peeks and still expands the card', async () => {
    vi.useFakeTimers()
    renderWith([unmatched('a.png')])

    await fireEvent.pointerDown(card(), TOUCH)
    vi.advanceTimersByTime(200)
    await fireEvent.pointerUp(card())
    vi.advanceTimersByTime(500)
    await nextTick()
    expect(hoverThumb()).toBeNull()

    await fireEvent.click(cardHead())
    expect(screen.getByText('Source Files')).toBeInTheDocument()
  })

  it('does not peek over an expanded card — its inline previews already show it', async () => {
    vi.useFakeTimers()
    renderWith([unmatched('a.png')])
    await fireEvent.click(cardHead())

    await fireEvent.pointerDown(card(), TOUCH)
    vi.advanceTimersByTime(500)
    await nextTick()
    expect(hoverThumb()).toBeNull()
  })

  it('a finger that slides past the tolerance cancels the pending peek', async () => {
    vi.useFakeTimers()
    renderWith([unmatched('a.png')])

    await fireEvent.pointerDown(card(), TOUCH)
    await fireEvent.pointerMove(card(), { pointerType: 'touch', clientX: 100, clientY: 145 })
    vi.advanceTimersByTime(500)
    await nextTick()
    expect(hoverThumb()).toBeNull()
  })

  it('a small drift inside the tolerance still peeks', async () => {
    vi.useFakeTimers()
    renderWith([unmatched('a.png')])

    await fireEvent.pointerDown(card(), TOUCH)
    await fireEvent.pointerMove(card(), { pointerType: 'touch', clientX: 104, clientY: 126 })
    vi.advanceTimersByTime(500)
    await nextTick()
    expect(hoverThumb()).not.toBeNull()
  })

  it('ignores a mouse pointer — hover already covers that case', async () => {
    vi.useFakeTimers()
    renderWith([unmatched('a.png')])

    await fireEvent.pointerDown(card(), { pointerType: 'mouse', clientX: 100, clientY: 120 })
    vi.advanceTimersByTime(500)
    await nextTick()
    expect(hoverThumb()).toBeNull()
  })

  it('is suppressed on a viewport too narrow to show the thumb', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('innerWidth', 480)
    try {
      renderWith([unmatched('a.png')])
      await fireEvent.pointerDown(card(), TOUCH)
      vi.advanceTimersByTime(500)
      await nextTick()
      expect(hoverThumb()).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

// Design rule 8: a coaching session loans RECORDS, never files. Every
// /_screenshot/ URL built from a loaned record resolves against the COACH's
// own disk under the player's filenames — a wrong image at best, and a
// request that had no business being made.
describe('UnknownUnmatchedSection — screenshots during a coaching session', () => {
  const ImageOriginal = globalThis.Image
  let issued: string[]

  beforeEach(() => {
    resetWriteGate()
    issued = []
    class FakeImage {
      set src(value: string) { issued.push(value) }
    }
    globalThis.Image = FakeImage as unknown as typeof Image
  })
  afterEach(() => { globalThis.Image = ImageOriginal; resetWriteGate() })

  it('requests no image and says screenshots are not part of a session', async () => {
    setWritesLocked(true, { session: true })
    renderWith([unmatched('a.png')])
    expect(issued).toEqual([])

    await fireEvent.click(cardHead())
    expect(screen.getByText(/Screenshots aren't included in a coaching session/)).toBeInTheDocument()
    // No filename link, so no href and no preview to open.
    expect(screen.queryByText('a.png')).toBeNull()
  })

  it('shows no cursor peek for a loaned record', async () => {
    setWritesLocked(true, { session: true })
    renderWith([unmatched('a.png')])
    await fireEvent.mouseEnter(card(), { clientX: 100, clientY: 120 })
    await nextTick()
    expect(hoverThumb()).toBeNull()
    expect(issued).toEqual([])
  })

  it("still previews the coach's own screenshots outside a session", async () => {
    renderWith([unmatched('a.png')])
    expect(issued).toEqual(['/_screenshot/0/a.png'])
    await fireEvent.click(cardHead())
    expect(screen.getByText('a.png')).toBeInTheDocument()
  })
})
