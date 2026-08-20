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
      filename: 'my-backup.zip', includeHidden: true, includeUnknown: false,
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
// able to tell which one they just made.// Sharing left this dialog entirely — it has its own now
// (SendToCoachModal). These are the guards that it stays gone: a checkbox
// nobody could find is exactly how it got buried the first time.
describe('ExportBundleModal — sharing is not its job', () => {
  it('offers no way to share, and asks for no identity', () => {
    renderModal()
    expect(screen.queryByRole('checkbox', { name: /Share with a coach/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Your handle (required)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Message for your coach/)).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Export bundle' })).toBeInTheDocument()
  })

  it('always offers a backup filename, never a share one', () => {
    renderModal()
    expect((screen.getByLabelText('Filename') as HTMLInputElement).value)
      .toMatch(/^recall-bundle-\d{8}-\d{6}\.zip$/)
  })

  // A backup is for the person who made it, and their own replay codes are
  // no business of it. The gate belongs to the coach path alone.
  it('ignores replay codes entirely', async () => {
    const view = renderModal()
    await user().click(submitBtn())
    expect(view.emitted('export')).toBeTruthy()
  })

  it('emits no share block at all', async () => {
    const view = renderModal()
    await user().click(submitBtn())
    const request = view.emitted<[Record<string, unknown>]>('export')![0]![0]
    expect(request).not.toHaveProperty('share')
  })
})

describe('ExportBundleModal — the eyebrow', () => {
  it('files itself under Data & Export', () => {
    renderModal()
    expect(screen.getByText('Data & Export')).toBeInTheDocument()
  })
})
