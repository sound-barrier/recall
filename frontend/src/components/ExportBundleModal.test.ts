import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import ExportBundleModal from './ExportBundleModal.vue'

function mountModal(over: {
  open?:          boolean
  selectedCount?: number
  hiddenCount?:   number
  unknownCount?:  number
} = {}) {
  return mount(ExportBundleModal, {
    props: {
      open:           over.open          ?? true,
      selectedCount:  over.selectedCount ?? 3,
      hiddenCount:    over.hiddenCount   ?? 2,
      unknownCount:   over.unknownCount  ?? 5,
    },
    attachTo: document.body,
  })
}

describe('ExportBundleModal — render gating', () => {
  it('renders nothing when open=false', () => {
    const w = mountModal({ open: false })
    expect(w.find('[data-testid="export-bundle-modal"]').exists()).toBe(false)
  })

  it('renders the dialog when open=true', () => {
    const w = mountModal({ open: true })
    const dialog = w.find('[data-testid="export-bundle-modal"]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.attributes('role')).toBe('dialog')
    expect(dialog.attributes('aria-modal')).toBe('true')
  })
})

describe('ExportBundleModal — count display', () => {
  it('shows the selected-matches count from props', () => {
    const w = mountModal({ selectedCount: 7 })
    expect(w.find('.export-bundle-value').text()).toContain('7')
  })

  it('shows the unknown + hidden counts inside their toggle labels', () => {
    const w = mountModal({ unknownCount: 12, hiddenCount: 4 })
    const text = w.text()
    expect(text).toContain('12')
    expect(text).toContain('4')
  })

  it('disables the unknown toggle when unknownCount is zero', () => {
    const w = mountModal({ unknownCount: 0 })
    const cb = w.find('[data-testid="include-unknown"]')
    expect(cb.attributes('disabled')).toBeDefined()
  })

  it('disables the hidden toggle when hiddenCount is zero', () => {
    const w = mountModal({ hiddenCount: 0 })
    const cb = w.find('[data-testid="include-hidden"]')
    expect(cb.attributes('disabled')).toBeDefined()
  })
})

describe('ExportBundleModal — preview count math', () => {
  it('preview defaults to selectedCount with both toggles off', () => {
    const w = mountModal({ selectedCount: 3, hiddenCount: 2, unknownCount: 5 })
    expect(w.find('.export-bundle-preview').text()).toMatch(/\b3\b/)
  })

  it('adds hiddenCount when include-hidden is ticked', async () => {
    const w = mountModal({ selectedCount: 3, hiddenCount: 2, unknownCount: 5 })
    await w.find('[data-testid="include-hidden"]').setValue(true)
    expect(w.find('.export-bundle-preview').text()).toMatch(/\b5\b/) // 3 + 2
  })

  it('adds both when both toggles are ticked', async () => {
    const w = mountModal({ selectedCount: 3, hiddenCount: 2, unknownCount: 5 })
    await w.find('[data-testid="include-hidden"]').setValue(true)
    await w.find('[data-testid="include-unknown"]').setValue(true)
    expect(w.find('.export-bundle-preview').text()).toMatch(/\b10\b/) // 3 + 2 + 5
  })
})

describe('ExportBundleModal — submit gating', () => {
  it('disables Export when previewCount is zero', () => {
    const w = mountModal({ selectedCount: 0, hiddenCount: 0, unknownCount: 0 })
    expect(w.find('[data-testid="export-submit"]').attributes('disabled')).toBeDefined()
  })

  it('enables Export when there is any record to export', () => {
    const w = mountModal({ selectedCount: 1, hiddenCount: 0, unknownCount: 0 })
    expect(w.find('[data-testid="export-submit"]').attributes('disabled')).toBeUndefined()
  })
})

describe('ExportBundleModal — emits', () => {
  it('emits "close" when Cancel is clicked', async () => {
    const w = mountModal()
    await w.find('.export-bundle-cancel').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
  })

  it('emits "close" when the backdrop is clicked', async () => {
    const w = mountModal()
    await w.find('.export-bundle-modal-backdrop').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
  })

  it('emits "export" with (filename, includeHidden, includeUnknown) on submit', async () => {
    const w = mountModal({ selectedCount: 2 })
    const fn = w.find('[data-testid="filename"]')
    await fn.setValue('my-backup.zip')
    await w.find('[data-testid="include-hidden"]').setValue(true)
    await w.find('[data-testid="export-submit"]').trigger('click')
    const e = w.emitted('export')
    expect(e).toBeTruthy()
    expect(e![0]).toEqual(['my-backup.zip', true, false])
  })
})

describe('ExportBundleModal — filename defaults', () => {
  it('seeds a recall-bundle-<timestamp>.zip default', () => {
    const w = mountModal()
    const fn = w.find('[data-testid="filename"]')
    expect((fn.element as HTMLInputElement).value).toMatch(/^recall-bundle-\d{8}-\d{6}\.zip$/)
  })
})
