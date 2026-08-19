import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { nextTick } from 'vue'

import ExportBundleModal from '@/components/matches/export/ExportBundleModal.vue'

function renderModal(over: {
  open?:          boolean
  selectedCount?: number
  hiddenCount?:   number
  unknownCount?:  number
  shareIntent?:   boolean
} = {}) {
  return render(ExportBundleModal, {
    props: {
      open:           over.open          ?? true,
      selectedCount:  over.selectedCount ?? 3,
      hiddenCount:    over.hiddenCount   ?? 2,
      unknownCount:   over.unknownCount  ?? 5,
      shareIntent:    over.shareIntent   ?? false,
    },
  })
}

const user = () => userEvent.setup()
const unknownToggle = () => screen.getByRole('checkbox', { name: /unknown match/ })
const hiddenToggle  = () => screen.getByRole('checkbox', { name: /hidden match/ })
const submitBtn     = () => screen.getByRole('button', { name: /Export/ })
const preview       = () => screen.getByText(/Bundle will include/)

describe('ExportBundleModal — render gating', () => {
  it('renders nothing when open=false', () => {
    renderModal({ open: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the dialog when open=true', () => {
    renderModal({ open: true })
    const dialog = screen.getByRole('dialog', { name: 'Export bundle' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })
})

describe('ExportBundleModal — count display', () => {
  it('shows the selected-matches count from props', () => {
    renderModal({ selectedCount: 7 })
    expect(screen.getByText('Selected matches')).toBeInTheDocument()
    // The count renders twice — the row value and the preview echo
    // (both toggles start off, so preview === selectedCount).
    expect(screen.getAllByText('7')).toHaveLength(2)
  })

  it('shows the unknown + hidden counts inside their toggle labels', () => {
    renderModal({ unknownCount: 12, hiddenCount: 4 })
    expect(screen.getByRole('checkbox', { name: 'Include 12 unknown matches' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Include 4 hidden matches' })).toBeInTheDocument()
  })

  it('drops the plural on every count that lands on exactly one', () => {
    renderModal({ selectedCount: 1, hiddenCount: 1, unknownCount: 1 })
    expect(screen.getByRole('checkbox', { name: 'Include 1 unknown match' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Include 1 hidden match' })).toBeInTheDocument()
    expect(preview()).toHaveTextContent(/1 match total/)
  })

  it('disables the unknown toggle when unknownCount is zero', () => {
    renderModal({ unknownCount: 0 })
    expect(unknownToggle()).toBeDisabled()
  })

  it('disables the hidden toggle when hiddenCount is zero', () => {
    renderModal({ hiddenCount: 0 })
    expect(hiddenToggle()).toBeDisabled()
  })
})

describe('ExportBundleModal — preview count math', () => {
  it('preview defaults to selectedCount with both toggles off', () => {
    renderModal({ selectedCount: 3, hiddenCount: 2, unknownCount: 5 })
    expect(preview()).toHaveTextContent(/\b3\b/)
  })

  it('adds hiddenCount when include-hidden is ticked', async () => {
    renderModal({ selectedCount: 3, hiddenCount: 2, unknownCount: 5 })
    await user().click(hiddenToggle())
    expect(preview()).toHaveTextContent(/\b5\b/) // 3 + 2
  })

  it('adds both when both toggles are ticked', async () => {
    renderModal({ selectedCount: 3, hiddenCount: 2, unknownCount: 5 })
    await user().click(hiddenToggle())
    await user().click(unknownToggle())
    expect(preview()).toHaveTextContent(/\b10\b/) // 3 + 2 + 5
  })
})

describe('ExportBundleModal — submit gating', () => {
  it('disables Export when previewCount is zero', () => {
    renderModal({ selectedCount: 0, hiddenCount: 0, unknownCount: 0 })
    expect(submitBtn()).toBeDisabled()
  })

  it('enables Export when there is any record to export', () => {
    renderModal({ selectedCount: 1, hiddenCount: 0, unknownCount: 0 })
    expect(submitBtn()).toBeEnabled()
  })
})

describe('ExportBundleModal — emits', () => {
  it('emits "close" when Cancel is clicked', async () => {
    const { emitted } = renderModal()
    await user().click(screen.getByRole('button', { name: 'Cancel' }))
    expect(emitted('close')).toBeTruthy()
  })

  it('emits "close" when the backdrop is clicked', async () => {
    const { emitted, baseElement } = renderModal()
    // The backdrop is a deliberately aria-hidden dimming layer.
    // eslint-disable-next-line testing-library/no-node-access -- aria-hidden dimming layer has no accessible surface
    await user().click(baseElement.querySelector('.export-bundle-modal-backdrop')!)
    expect(emitted('close')).toBeTruthy()
  })

  it('emits "export" with the whole request on submit', async () => {
    const { emitted } = renderModal({ selectedCount: 2 })
    const fn = screen.getByLabelText('Filename')
    await user().clear(fn)
    await user().type(fn, 'my-backup.zip')
    await user().click(hiddenToggle())
    await user().click(submitBtn())
    const e = emitted('export')
    expect(e).toBeTruthy()
    expect(e[0]).toEqual([{
      filename: 'my-backup.zip', includeHidden: true, includeUnknown: false, share: null,
    }])
  })
})

describe('ExportBundleModal — filename defaults', () => {
  it('seeds a recall-bundle-<timestamp>.zip default', () => {
    renderModal()
    expect(screen.getByLabelText('Filename')).toHaveDisplayValue(/^recall-bundle-\d{8}-\d{6}\.zip$/)
  })
})

// The modal wires its own focus trap instead of useModalFocusTrap, so
// none of the shared composable's coverage applies: the Esc handler, the
// Tab cycle, the focus hand-off, and — the part that bites — the listener
// teardown all live here.
describe('ExportBundleModal — keyboard contract', () => {
  // The open-watch hands focus to the filename field one tick after the
  // dialog appears; settle that before a test parks focus of its own.
  async function renderSettled(over: Parameters<typeof renderModal>[0] = {}) {
    const view = renderModal(over)
    await nextTick()
    await nextTick()
    return view
  }

  it('dismisses on Escape', async () => {
    const { emitted } = await renderSettled()
    await fireEvent.keyDown(document, { key: 'Escape' })
    expect(emitted('close')).toBeTruthy()
  })

  it('wraps Tab from the last control back to the first', async () => {
    await renderSettled()
    submitBtn().focus()

    await fireEvent.keyDown(document, { key: 'Tab' })

    expect(unknownToggle()).toHaveFocus()
  })

  it('wraps Shift+Tab from the first control to the last', async () => {
    await renderSettled()
    unknownToggle().focus()

    await fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })

    expect(submitBtn()).toHaveFocus()
  })

  it('leaves an interior Tab to the browser', async () => {
    await renderSettled()
    const filename = screen.getByLabelText('Filename')
    filename.focus()

    await fireEvent.keyDown(document, { key: 'Tab' })

    // Nothing was force-moved — the native tab order takes it from here.
    expect(filename).toHaveFocus()
  })

  it('skips a disabled control when computing the cycle', async () => {
    // With no unknown records the first toggle is disabled, so the wrap
    // target is the hidden toggle — a trap that ignored :disabled would
    // park focus on an unreachable control.
    await renderSettled({ unknownCount: 0 })
    submitBtn().focus()

    await fireEvent.keyDown(document, { key: 'Tab' })

    expect(hiddenToggle()).toHaveFocus()
  })
})

describe('ExportBundleModal — open/close lifecycle', () => {
  it('moves focus to the filename field on open and back to the opener on close', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    const { rerender } = renderModal({ open: false })
    await rerender({ open: true, selectedCount: 3, hiddenCount: 2, unknownCount: 5 })
    await nextTick()
    expect(screen.getByLabelText('Filename')).toHaveFocus()

    await rerender({ open: false, selectedCount: 3, hiddenCount: 2, unknownCount: 5 })
    await nextTick()
    expect(opener).toHaveFocus()

    opener.remove()
  })

  it('resets the filename and both toggles when reopened', async () => {
    const { rerender } = renderModal({ selectedCount: 2 })
    const filename = screen.getByLabelText('Filename')
    await user().clear(filename)
    await user().type(filename, 'last-run.zip')
    await user().click(hiddenToggle())

    await rerender({ open: false, selectedCount: 2, hiddenCount: 2, unknownCount: 5 })
    await rerender({ open: true, selectedCount: 2, hiddenCount: 2, unknownCount: 5 })
    await nextTick()

    expect(screen.getByLabelText('Filename')).toHaveDisplayValue(/^recall-bundle-\d{8}-\d{6}\.zip$/)
    expect(hiddenToggle()).not.toBeChecked()
    expect(unknownToggle()).not.toBeChecked()
  })

  it('stops listening for Escape once closed', async () => {
    const { emitted, rerender } = renderModal()
    await rerender({ open: false, selectedCount: 3, hiddenCount: 2, unknownCount: 5 })
    await nextTick()

    await fireEvent.keyDown(document, { key: 'Escape' })

    // A leaked document listener would keep emitting close from a closed
    // modal — and, stacked under another dialog, would swallow its Esc.
    expect(emitted('close')).toBeUndefined()
  })
})

// Two exports leave this modal and they are not the same artifact: a plain
// bundle is a backup, a share bundle names its player so a coach can open it
// as a session (and a mis-clicked Import refuses it). The player has to be
// able to tell which one they just made.
describe('ExportBundleModal — sharing with a coach', () => {
  const shareToggle = () => screen.getByRole('checkbox', { name: /Share with a coach/ })
  const handleField = () => screen.getByLabelText('Your handle (required)')

  it('offers a plain export by default, with no identity asked for', () => {
    renderModal()
    expect(shareToggle()).not.toBeChecked()
    expect(screen.queryByLabelText('Your handle (required)')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Export bundle' })).toBeInTheDocument()
  })

  // "Send matches out" on the Reviews tab and the palette's share action
  // mean share — the dialog opens in that mode rather than making the player
  // find the toggle, and titles itself for it.
  it('opens already in share mode when the caller meant to share', () => {
    renderModal({ shareIntent: true })
    expect(shareToggle()).toBeChecked()
    expect(handleField()).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Share with a coach' })).toBeInTheDocument()
  })

  it('asks who the coach is reviewing once share mode is on', async () => {
    renderModal()
    await user().click(shareToggle())
    expect(handleField()).toBeInTheDocument()
    expect(screen.getByLabelText(/Message for your coach/)).toBeInTheDocument()
  })

  // The default filename the modal OFFERS. What the saved file is actually
  // called is api-platform's fallback stem, asserted in api.test.ts — this
  // field is a suggestion the export path does not read.
  it('renames itself, the button and the filename it offers, so the two modes cannot be confused', async () => {
    renderModal()
    await user().click(shareToggle())
    expect(screen.getByRole('dialog', { name: 'Share with a coach' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
    expect(screen.getByLabelText('Filename')).toHaveDisplayValue(/^recall-share-\d{8}-\d{6}\.zip$/)
  })

  it('will not share until the handle is filled in', async () => {
    renderModal()
    await user().click(shareToggle())
    expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled()
    await user().type(handleField(), 'Sable')
    expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled()
  })

  it('emits the share identity with the request', async () => {
    const { emitted } = renderModal({ selectedCount: 2 })
    await user().click(shareToggle())
    await user().type(handleField(), 'Sable')
    await user().type(screen.getByLabelText(/Message for your coach/), 'Ult timing?')
    await user().click(screen.getByRole('button', { name: 'Share' }))

    expect(emitted('export')[0]).toEqual([expect.objectContaining({
      includeHidden: false,
      includeUnknown: false,
      share: { handle: 'Sable', message: 'Ult timing?' },
    })])
  })

  it('emits no identity for a plain export', async () => {
    const { emitted } = renderModal({ selectedCount: 2 })
    await user().click(hiddenToggle())
    await user().click(submitBtn())

    expect(emitted('export')[0]).toEqual([expect.objectContaining({
      includeHidden: true,
      includeUnknown: false,
      share: null,
    })])
  })

  it('drops back to a plain export when the modal is reopened', async () => {
    const { rerender } = renderModal()
    await user().click(shareToggle())
    await rerender({ open: false, selectedCount: 3, hiddenCount: 2, unknownCount: 5 })
    await rerender({ open: true, selectedCount: 3, hiddenCount: 2, unknownCount: 5 })
    await nextTick()

    expect(shareToggle()).not.toBeChecked()
  })
})

describe('ExportBundleModal — the eyebrow', () => {
  it('reads as prose in both modes', async () => {
    renderModal()
    expect(screen.getByText('Data & Export')).toBeInTheDocument()
    await user().click(screen.getByRole('checkbox', { name: /Share with a coach/ }))
    expect(screen.getByText('Coaching')).toBeInTheDocument()
  })
})
