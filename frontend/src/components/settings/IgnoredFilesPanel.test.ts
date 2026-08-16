// SFC tests for IgnoredFilesPanel — the Settings → Advanced → "Manage
// ignored files" modal. Backend wiring + the broader Delete-forever →
// Restore → Re-parse round-trip live in the e2e spec
// `unknown-restore-ignored.spec.ts`; here we cover the in-component
// state machine (arm/disarm), per-row emits, and accessibility-y
// branches (empty state, restore footer, Escape close).

import { render, screen, fireEvent } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'

import IgnoredFilesPanel from '@/components/settings/IgnoredFilesPanel.vue'

// The write gate reads the profiles query + the coaching-session store;
// these cases pin this component's own contract, so stub it open.
vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))

const SAMPLE = [
  { filename: 'a.png', ignored_at: '2026-06-04T15:00:00Z' },
  { filename: 'b.png', ignored_at: '2026-06-04T14:00:00Z' },
]

function renderPanel(overrides: Partial<{ isOpen: boolean; screenshots: typeof SAMPLE }> = {}) {
  return render(IgnoredFilesPanel, {
    props: {
      isOpen:        overrides.isOpen ?? true,
      screenshots:   overrides.screenshots ?? SAMPLE,
      screenshotURL: (f: string) => `/_screenshot/${encodeURIComponent(f)}`,
    },
  })
}

const user = () => userEvent.setup()
const restoreAll = () => screen.queryByRole('button', { name: /Re-enable all/ })
const hoverThumb = () => screen.queryByAltText('Preview of a.png')

describe('IgnoredFilesPanel', () => {
  it('renders nothing when isOpen=false', () => {
    renderPanel({ isOpen: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders count + one row per screenshot', () => {
    renderPanel()
    expect(screen.getByLabelText('2 ignored files')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    const firstThumb = screen.getByAltText('a.png')
    expect(firstThumb).toHaveAttribute('src', expect.stringContaining(encodeURIComponent('a.png')))
    expect(firstThumb).toHaveAttribute('loading', 'lazy')
  })

  it('clicking the thumbnail emits open-lightbox with the full filename list', async () => {
    const { emitted } = renderPanel()
    await user().click(screen.getByRole('button', { name: 'Open a.png in fullscreen lightbox' }))
    const emits = emitted<unknown[]>('open-lightbox')
    expect(emits).toBeTruthy()
    // Signature: (filename, files, dirIDs).
    expect(emits[0]![0]).toBe('a.png')
    expect(emits[0]![1]).toEqual(['a.png', 'b.png'])
    expect(emits[0]![2]).toEqual({})
  })

  it('mouseenter on a row pops the cursor-anchored floating thumb (Teleport to body)', async () => {
    renderPanel()
    // No hover thumb yet.
    expect(hoverThumb()).not.toBeInTheDocument()
    // mouseenter installs the thumb with the row's filename.
    const row = screen.getAllByRole('listitem')[0]!
    await fireEvent.mouseEnter(row, { clientX: 100, clientY: 100 })
    expect(hoverThumb()).toHaveAttribute('src', expect.stringContaining(encodeURIComponent('a.png')))
    // mouseleave clears it.
    await fireEvent.mouseLeave(row)
    expect(hoverThumb()).not.toBeInTheDocument()
  })

  it('closing the panel clears any in-flight hover thumb', async () => {
    const { rerender } = renderPanel()
    await fireEvent.mouseEnter(screen.getAllByRole('listitem')[0]!, { clientX: 100, clientY: 100 })
    expect(hoverThumb()).toBeInTheDocument()
    // Simulate App.vue dropping isOpen to false. The watch on isOpen
    // must clear hoveredFilename even though no mouseleave fired.
    await rerender({ isOpen: false })
    expect(hoverThumb()).not.toBeInTheDocument()
  })

  it('shows empty-state copy when the list is empty', () => {
    renderPanel({ screenshots: [] })
    expect(screen.getByText(/Nothing ignored/)).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    // The bulk-action button MUST be hidden — "Re-enable all (0)" would
    // be confusing and a no-op.
    expect(restoreAll()).not.toBeInTheDocument()
  })

  it('per-row Restore emits restore with the filename', async () => {
    const { emitted } = renderPanel()
    await user().click(screen.getAllByRole('button', { name: 'Restore' })[0]!)
    expect(emitted('restore')).toEqual([['a.png']])
  })

  it('shows the Run-Parse footer after a per-row Restore', async () => {
    const { emitted } = renderPanel()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await user().click(screen.getAllByRole('button', { name: 'Restore' })[0]!)
    expect(screen.getByRole('status')).toHaveTextContent('Restored.')
    await user().click(screen.getByRole('button', { name: 'Run Parse now' }))
    expect(emitted('run-parse')).toBeTruthy()
  })

  it('Re-enable all is two-step: arm then confirm', async () => {
    const { emitted } = renderPanel()
    // First click arms — Confirm? hint appears, original button replaced.
    await user().click(restoreAll()!)
    expect(emitted('restore-all')).toBeFalsy()
    expect(screen.getByText('Confirm?')).toBeInTheDocument()
    expect(restoreAll()).not.toBeInTheDocument()
    // Second click confirms.
    await user().click(screen.getByRole('button', { name: 'Yes, re-enable all' }))
    expect(emitted('restore-all')).toEqual([[]])
  })

  it('Cancel disarms without emitting restore-all', async () => {
    const { emitted } = renderPanel()
    await user().click(restoreAll()!)
    await user().click(screen.getByRole('button', { name: 'Cancel' }))
    expect(emitted('restore-all')).toBeFalsy()
    expect(restoreAll()).toBeInTheDocument()
  })

  it('3 s auto-disarm timer drops the arm if the user walks away', async () => {
    vi.useFakeTimers()
    try {
      renderPanel()
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) }).click(restoreAll()!)
      expect(screen.getByText('Confirm?')).toBeInTheDocument()
      vi.advanceTimersByTime(3100)
      // Vue re-renders on the next tick; assert state via DOM after a
      // microtask flush.
      await nextTick()
      expect(screen.queryByText('Confirm?')).not.toBeInTheDocument()
      expect(restoreAll()).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('Close button emits close', async () => {
    const { emitted } = renderPanel()
    await user().click(screen.getByRole('button', { name: 'Close ignored files panel' }))
    expect(emitted('close')).toBeTruthy()
  })

  it('Backdrop click emits close; inner-panel click does not', async () => {
    const { emitted } = renderPanel()
    // Clicking the backdrop where currentTarget === target → close.
    await user().click(screen.getByRole('dialog'))
    expect(emitted('close')).toBeTruthy()
    // Clicking inside the panel (not the backdrop) → no close emit.
    const before = emitted('close').length
    await user().click(screen.getByRole('heading', { name: /Ignored screenshots/ }))
    expect(emitted('close')).toHaveLength(before)
  })

  // NOTE: Escape close uses a capture-phase document keydown listener.
  // happy-dom doesn't fire capture-phase listeners from synthesized
  // KeyboardEvents (same limitation MatchScreenshotLightbox runs into,
  // see its test file comment) — the Escape contract is exercised in
  // the Playwright e2e instead. The unit test would be a stub.
})
