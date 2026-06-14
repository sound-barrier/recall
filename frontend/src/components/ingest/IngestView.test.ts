import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import IngestView from '@/components/ingest/IngestView.vue'

// Default props: a fresh install with Tesseract detected and a
// configured screenshots folder. Tests override only the fields
// they're asserting against. After the Settings consolidation,
// IngestView no longer carries tesseractStatus / picker / export /
// import / clear-db state — those moved to SettingsView.
function mountIngest(over: Partial<Record<string, unknown>> = {}) {
  return mount(IngestView, {
    props: {
      tesseractReady: true,
      screenshotsDir: '/srv/recall',
      watchEnabled: false,
      parseBusy: false,
      cancellingParse: false,
      newScreenshotCount: 3,
      lastParsedAt: null,
      parseProgress: null,
      parseLog: [],
      parseProgressOpen: false,
      matchedCount: 0,
      unknownCount: 0,
      ...over,
    },
  })
}

describe('IngestView (Parse tab)', () => {
  it('renders the "Tesseract isn\'t located" heading when not ready', () => {
    const wrapper = mountIngest({ tesseractReady: false })
    expect(wrapper.text()).toContain("Tesseract isn't located")
    // Points users to Settings, not anywhere on this tab.
    expect(wrapper.text()).toContain('Settings → Engine')
  })

  it('renders the "set a screenshots folder" heading when no dir is set', () => {
    const wrapper = mountIngest({ screenshotsDir: '' })
    expect(wrapper.text()).toContain('Set a')
    expect(wrapper.text()).toContain('Settings → Folders')
  })

  it('renders the "Ready to parse" heading on a clean install', () => {
    const wrapper = mountIngest()
    expect(wrapper.text()).toContain('Ready to parse')
  })

  it('shows the matched-count heading after parses exist', () => {
    const wrapper = mountIngest({ matchedCount: 42 })
    expect(wrapper.text()).toContain('42 matches')
  })

  it('shows the "Watching" heading when watch is armed', () => {
    const wrapper = mountIngest({ watchEnabled: true })
    expect(wrapper.text()).toContain('Watching')
  })

  it('Run Parse button emits parse on click', async () => {
    const wrapper = mountIngest({ newScreenshotCount: 5 })
    const btn = wrapper.findAll('button').find(b => b.text().includes('Run Parse'))!
    await btn.trigger('click')
    expect(wrapper.emitted('parse')).toBeTruthy()
  })

  it('Run Parse button is disabled with "All parsed" copy when newScreenshotCount is 0', () => {
    const wrapper = mountIngest({ newScreenshotCount: 0 })
    const btn = wrapper.findAll('button').find(b => b.text().includes('All parsed'))!
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.text()).toContain('nothing new')
    expect(btn.classes()).toContain('ghost')
  })

  it('emits toggle-watch on the Watch Folder checkbox change', async () => {
    const wrapper = mountIngest()
    const checkbox = wrapper.find('input[type="checkbox"]')
    await checkbox.trigger('change')
    expect(wrapper.emitted('toggle-watch')).toBeTruthy()
  })

  it('emits go-to-view "settings" when the Settings link is clicked', async () => {
    const wrapper = mountIngest({ screenshotsDir: '' })
    const link = wrapper.findAll('.empty-link').find(el => el.text().includes('Settings'))!
    await link.trigger('click')
    expect(wrapper.emitted('go-to-view')).toBeTruthy()
    expect(wrapper.emitted('go-to-view')![0]).toEqual(['settings'])
  })

  it('disables Watch Folder while Tesseract is unavailable, and offers a Settings shortcut', async () => {
    const wrapper = mountIngest({ tesseractReady: false })
    const cb = wrapper.find('input[type="checkbox"]')
    expect((cb.element as HTMLInputElement).disabled).toBe(true)
    const fix = wrapper.findAll('.empty-link').find(el => el.text().includes('Fix in Settings'))!
    expect(fix).toBeDefined()
    await fix.trigger('click')
    expect(wrapper.emitted('go-to-view')).toBeTruthy()
    expect(wrapper.emitted('go-to-view')![0]).toEqual(['settings'])
  })

  it('renders only the Parse section — no Engine / Export / Data sections', () => {
    const wrapper = mountIngest()
    const sections = wrapper.findAll('.settings-section')
    expect(sections).toHaveLength(1)
    expect(wrapper.text()).not.toContain('Engine')
    expect(wrapper.text()).not.toContain('Export Data')
    expect(wrapper.text()).not.toContain('Clear Database')
  })
})

describe('IngestView — Stop Parse button (item 15)', () => {
  it('renders Run Parse when not busy; no Stop button in the DOM', () => {
    const wrapper = mountIngest({ parseBusy: false })
    expect(wrapper.find('[data-testid="cancel-parse-btn"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Run Parse')
  })

  it('renders Stop Parse when parseBusy and not yet cancelling', () => {
    const wrapper = mountIngest({ parseBusy: true })
    const stop = wrapper.find('[data-testid="cancel-parse-btn"]')
    expect(stop.exists()).toBe(true)
    expect(stop.text()).toContain('Stop Parse')
    expect((stop.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('renders Cancelling… + disables itself when cancellingParse is true', () => {
    const wrapper = mountIngest({ parseBusy: true, cancellingParse: true })
    const stop = wrapper.find('[data-testid="cancel-parse-btn"]')
    expect(stop.exists()).toBe(true)
    expect(stop.text()).toContain('Cancelling…')
    expect((stop.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('click on the Stop button emits cancel-parse', async () => {
    const wrapper = mountIngest({ parseBusy: true })
    await wrapper.find('[data-testid="cancel-parse-btn"]').trigger('click')
    expect(wrapper.emitted('cancel-parse')).toBeTruthy()
    expect(wrapper.emitted('cancel-parse')).toHaveLength(1)
  })
})
