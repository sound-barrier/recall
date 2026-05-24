import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import IngestView from './IngestView.vue'
import type { TesseractStatus } from '../api'

// Default props: a fresh install with Tesseract detected and a
// configured screenshots folder. Tests override only the fields
// they're asserting against.
function readyTesseract(over: Partial<TesseractStatus> = {}): TesseractStatus {
  return {
    path: '/usr/local/bin/tesseract',
    found: true,
    version: '5.5.0',
    supported: true,
    error: '',
    default: '/usr/local/bin/tesseract',
    ...over,
  }
}

function mountIngest(over: Partial<Record<string, unknown>> = {}) {
  return mount(IngestView, {
    props: {
      tesseractReady: true,
      tesseractSupported: true,
      tesseractStatus: readyTesseract(),
      tesseractPickerBusy: false,
      screenshotsDir: '/srv/owmetrics',
      watchEnabled: false,
      loading: false,
      newScreenshotCount: 3,
      lastParsedAt: null,
      parseProgress: null,
      parseLog: [],
      parseProgressOpen: false,
      matchedCount: 0,
      unknownCount: 0,
      prometheusEnabled: false,
      clearConfirm: false,
      clearingDB: false,
      ...over,
    },
  })
}

describe('IngestView', () => {
  it('renders the "Tesseract is missing" heading when not ready', () => {
    const wrapper = mountIngest({ tesseractReady: false, tesseractStatus: readyTesseract({ found: false }) })
    expect(wrapper.text()).toContain("can't OCR")
    expect(wrapper.text()).toContain('Tesseract is located')
  })

  it('renders the "set a screenshots folder" heading when no dir is set', () => {
    const wrapper = mountIngest({ screenshotsDir: '' })
    expect(wrapper.text()).toContain('Set a')
    expect(wrapper.text()).toContain('screenshots folder')
  })

  it('renders the "Ready to parse" heading on a clean install', () => {
    const wrapper = mountIngest({ matchedCount: 0, watchEnabled: false })
    expect(wrapper.text()).toMatch(/Ready to parse from/)
  })

  it('shows the matched-count heading after parses exist', () => {
    const wrapper = mountIngest({ matchedCount: 12 })
    expect(wrapper.text()).toMatch(/12 matches.*parsed from/)
  })

  it('shows the "Watching" heading when watch is armed', () => {
    const wrapper = mountIngest({ watchEnabled: true })
    expect(wrapper.text()).toContain('Watching')
  })

  it('Run Parse button emits parse on click', async () => {
    const wrapper = mountIngest()
    const btn = wrapper.findAll('button').find(b => b.text().includes('Run Parse'))!
    await btn.trigger('click')
    expect(wrapper.emitted('parse')).toBeTruthy()
  })

  it('Run Parse button is disabled when newScreenshotCount is 0', () => {
    const wrapper = mountIngest({ newScreenshotCount: 0 })
    const btn = wrapper.findAll('button').find(b => b.text().includes('Run Parse'))!
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('emits toggle-watch on the watch-folder checkbox change', async () => {
    const wrapper = mountIngest()
    const inputs = wrapper.findAll('input[type="checkbox"]')
    // Watch is the first checkbox (Parse section); Prometheus is second.
    await inputs[0]!.trigger('change')
    expect(wrapper.emitted('toggle-watch')).toBeTruthy()
  })

  it('emits toggle-prometheus on the Prometheus checkbox change', async () => {
    const wrapper = mountIngest()
    const inputs = wrapper.findAll('input[type="checkbox"]')
    await inputs[1]!.trigger('change')
    expect(wrapper.emitted('toggle-prometheus')).toBeTruthy()
  })

  it('emits arm-clear when Clear Database is clicked, and shows confirm UI', async () => {
    const wrapper = mountIngest({ matchedCount: 4 })
    const armBtn = wrapper.findAll('button').find(b => b.text().includes('Clear Database…'))!
    await armBtn.trigger('click')
    expect(wrapper.emitted('arm-clear')).toBeTruthy()
  })

  it('confirm flow exposes the Delete button + Cancel', async () => {
    const wrapper = mountIngest({ matchedCount: 4, clearConfirm: true })
    const deleteBtn = wrapper.findAll('button').find(b => b.text().includes('Delete 4 Records'))!
    const cancelBtn = wrapper.findAll('button').find(b => b.text() === 'Cancel')!
    expect(deleteBtn.exists()).toBe(true)
    expect(cancelBtn.exists()).toBe(true)
    await deleteBtn.trigger('click')
    expect(wrapper.emitted('clear-database')).toBeTruthy()
    await cancelBtn.trigger('click')
    expect(wrapper.emitted('cancel-clear')).toBeTruthy()
  })

  it('engine-unsupported warning appears for non-5.x Tesseract', () => {
    const wrapper = mountIngest({
      tesseractSupported: false,
      tesseractStatus: readyTesseract({ version: '4.1.1', supported: false }),
    })
    const warn = wrapper.find('.engine-unsupported-warn')
    expect(warn.exists()).toBe(true)
    // role="status" (polite), not role="alert" — the warning is
    // informational; parsing still works, the user is just on an
    // untested version. role="alert" would interrupt screen readers
    // every time the panel renders.
    expect(warn.attributes('role')).toBe('status')
  })

  it('emits reset-tesseract when "Use default" is clicked', async () => {
    const wrapper = mountIngest({
      tesseractStatus: readyTesseract({ path: '/elsewhere/tesseract', default: '/usr/local/bin/tesseract' }),
    })
    const link = wrapper.findAll('.link-btn').find(b => b.text().includes('Use default'))!
    await link.trigger('click')
    expect(wrapper.emitted('reset-tesseract')).toBeTruthy()
  })

  it('emits pick-tesseract from the Locate/Change button', async () => {
    const wrapper = mountIngest()
    const btn = wrapper.findAll('button').find(b => b.text().includes('Change Binary'))!
    await btn.trigger('click')
    expect(wrapper.emitted('pick-tesseract')).toBeTruthy()
  })

  it('emits go-to-view "settings" when the Settings link is clicked', async () => {
    const wrapper = mountIngest({ screenshotsDir: '' })
    const link = wrapper.findAll('.empty-link').find(el => el.text().includes('Settings'))!
    await link.trigger('click')
    expect(wrapper.emitted('go-to-view')).toBeTruthy()
    expect(wrapper.emitted('go-to-view')![0]).toEqual(['settings'])
  })
})
