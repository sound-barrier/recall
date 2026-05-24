import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountApp } from './test-utils/mountApp'

// Smoke + behavior tests for App.vue. These do not try to cover every
// branch of the 4700-line SFC — the helpers and composables under it
// have their own dedicated test files. The goal here is to verify
// that App wires those pieces together correctly: API → composables
// → DOM. Coverage rolls up via `make cover-frontend`.

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('App.vue', () => {
  it('mounts without throwing and shows the RECALL masthead', async () => {
    const wrapper = await mountApp()
    expect(wrapper.find('.masthead').exists()).toBe(true)
    // Masthead text uses the OW Wordmark font on "RECALL".
    expect(wrapper.text()).toContain('RECALL')
  })

  it('defaults to the Matches tab on initial load', async () => {
    const wrapper = await mountApp()
    // Active tab is reflected in the aria-selected attribute, which the
    // tablist semantics make easy to query without coupling to CSS class
    // names that could shift with theme work.
    const matchesTab = wrapper.find('#tab-matches')
    expect(matchesTab.attributes('aria-selected')).toBe('true')

    const settingsTab = wrapper.find('#tab-settings')
    expect(settingsTab.attributes('aria-selected')).toBe('false')
  })

  it('calls GetMatchResults once on mount via the load() Promise.all', async () => {
    // The mock-factory exports are vi.fn()'s; we re-import the mocked
    // module to inspect call counts. The dynamic import inside
    // mountApp() ensures we read the same module record App.vue saw.
    await mountApp({
      records: [
        // Minimal valid MatchRecord — only the fields the helpers actually read.
        { id: 1, match_key: 'match:2026-05-10T21:29:28', source_files: ['a.png'], data: {
          map: 'rialto', date: '2026-05-10', finished_at: '21:29', result: 'victory',
        } },
      ],
    })
    const api = await import('./api')
    expect(api.GetMatchResults).toHaveBeenCalledTimes(1)
    expect(api.GetTesseractStatus).toHaveBeenCalledTimes(1)
  })

  it('switching tabs swaps the visible view panel', async () => {
    const wrapper = await mountApp()
    // Matches view is rendered by default.
    expect(wrapper.find('#panel-matches').exists()).toBe(true)

    // Click the Settings tab; the matches panel disappears, the
    // settings panel appears.
    await wrapper.find('#tab-settings').trigger('click')
    expect(wrapper.find('#panel-settings').exists()).toBe(true)
    expect(wrapper.find('#panel-matches').exists()).toBe(false)

    // And back: clicking matches restores it.
    await wrapper.find('#tab-matches').trigger('click')
    expect(wrapper.find('#panel-matches').exists()).toBe(true)
    expect(wrapper.find('#panel-settings').exists()).toBe(false)
  })

  // Note: UNKNOWN DATE bucket rendering is covered directly in
  // MatchesView.test.ts (it can pin the includeUndated prop). Mounting
  // App.vue end-to-end with localStorage-seeded preferences is
  // brittle in happy-dom + dynamic import — keep that coverage at
  // the component-test layer where the seam is explicit.

  it('renders the brandmark as a link to the GitHub repo', async () => {
    const wrapper = await mountApp()
    const brand = wrapper.find('a.brandmark-link')
    expect(brand.exists()).toBe(true)
    expect(brand.attributes('href')).toBe('https://github.com/sound-barrier/recall')
    expect(brand.attributes('target')).toBe('_blank')
    expect(brand.attributes('rel')).toContain('noopener')
    expect(brand.attributes('aria-label')).toContain('GitHub')
  })

  it('clicking the brandmark routes through OpenURL (so Wails opens the system browser)', async () => {
    const wrapper = await mountApp()
    const api = await import('./api')
    await wrapper.find('a.brandmark-link').trigger('click')
    expect(api.OpenURL).toHaveBeenCalledWith('https://github.com/sound-barrier/recall')
  })
})

describe('App.vue — unsupported-tesseract modal a11y', () => {
  async function openUnsupportedModal() {
    // Tesseract is detected but reports an unsupported version (e.g. 4.x).
    // Clicking Run Parse opens the confirmation modal instead of parsing.
    const wrapper = await mountApp({
      screenshotsDir: '/home/me/shots',
      newScreenshotCount: 3,
      tesseract: { found: true, supported: false, version: '4.1.1' },
    })
    await wrapper.find('#tab-ingest').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.btn.primary.big').trigger('click') // Run Parse
    await wrapper.vm.$nextTick()
    return wrapper
  }

  it('opening the modal moves focus to the first focusable (Cancel)', async () => {
    const wrapper = await openUnsupportedModal()
    expect(wrapper.find('.modal-box').exists()).toBe(true)
    // Cancel is the first <button> inside .modal-actions by markup order,
    // chosen specifically so destructive primary actions (Continue
    // Anyway) never receive default focus.
    const cancel = wrapper.findAll('.modal-actions button')[0]!
    expect(document.activeElement).toBe(cancel.element)
  })

  it('Escape on document closes the modal', async () => {
    const wrapper = await openUnsupportedModal()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.modal-box').exists()).toBe(false)
  })

  it('background container is marked inert and aria-hidden while open', async () => {
    const wrapper = await openUnsupportedModal()
    const container = wrapper.find('.container')
    // Vue serialises boolean inert as the attribute being present.
    expect(container.attributes('inert')).toBeDefined()
    expect(container.attributes('aria-hidden')).toBe('true')
  })
})
