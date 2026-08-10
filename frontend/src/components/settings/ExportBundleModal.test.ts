import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'

import ExportBundleModal from '@/components/settings/ExportBundleModal.vue'

function renderModal(over: {
  open?:          boolean
  selectedCount?: number
  hiddenCount?:   number
  unknownCount?:  number
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

  it('emits "export" with (filename, includeHidden, includeUnknown) on submit', async () => {
    const { emitted } = renderModal({ selectedCount: 2 })
    const fn = screen.getByLabelText('Filename')
    await user().clear(fn)
    await user().type(fn, 'my-backup.zip')
    await user().click(hiddenToggle())
    await user().click(submitBtn())
    const e = emitted('export')
    expect(e).toBeTruthy()
    expect(e[0]).toEqual(['my-backup.zip', true, false])
  })
})

describe('ExportBundleModal — filename defaults', () => {
  it('seeds a recall-bundle-<timestamp>.zip default', () => {
    renderModal()
    expect(screen.getByLabelText('Filename')).toHaveDisplayValue(/^recall-bundle-\d{8}-\d{6}\.zip$/)
  })
})
