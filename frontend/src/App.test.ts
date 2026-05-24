import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { MatchRecord } from './api'
import { fireEvent, mountApp } from './test-utils/mountApp'

// Smoke + behavior tests for App.vue. These do not try to cover every
// branch of the ~4500-line SFC — the helpers and composables under it
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

describe('App.vue — scoreboard pulse on watcher refresh', () => {
  // Watcher-driven (or manual) parse fires a parse-complete event. The
  // App's handler calls load(); when load sees the records count grew,
  // it flashes a pulse class on the scoreboard so the user notices.
  it('adds .pulse to the scoreboard when records grow on parse-complete', async () => {
    const initial: MatchRecord[] = [
      { id: 1, match_key: 'match:2026-05-10T21:29:28', source_files: ['a.png'], data: {
        map: 'rialto', date: '2026-05-10', finished_at: '21:29', result: 'victory',
      } },
    ]
    const wrapper = await mountApp({ records: initial })
    expect(wrapper.find('.scoreboard').classes()).not.toContain('pulse')

    // Re-mock GetMatchResults so the next load() returns one more record.
    const api = await import('./api')
    const grown: MatchRecord[] = [
      ...initial,
      { id: 2, match_key: 'match:2026-05-10T22:14:02', source_files: ['b.png'], data: {
        map: 'aatlis', date: '2026-05-10', finished_at: '22:14', result: 'defeat',
      } },
    ]
    ;(api.GetMatchResults as ReturnType<typeof vi.fn>).mockResolvedValueOnce(grown)

    // Fire the watcher event the way the runtime would. The handler
    // re-runs load() asynchronously, so flushPromises lets the
    // Promise.all + the post-load reactive update settle.
    expect(fireEvent('parse-complete')).toBe(true)
    await flushPromises()
    expect(wrapper.find('.scoreboard').classes()).toContain('pulse')
  })

  it('does NOT pulse when records count is unchanged on parse-complete', async () => {
    const seed: MatchRecord[] = [
      { id: 1, match_key: 'match:2026-05-10T21:29:28', source_files: ['a.png'], data: {
        map: 'rialto', date: '2026-05-10', finished_at: '21:29', result: 'victory',
      } },
    ]
    const wrapper = await mountApp({ records: seed })
    expect(fireEvent('parse-complete')).toBe(true)
    await flushPromises()
    expect(wrapper.find('.scoreboard').classes()).not.toContain('pulse')
  })
})

describe('App.vue — tablist keyboard navigation', () => {
  // WAI-ARIA tab pattern with automatic activation: ArrowLeft/Right wrap
  // through the tabs, Home/End jump to either end, and each keypress
  // both moves focus AND switches the visible view.
  it('ArrowRight from Settings activates Ingest', async () => {
    const wrapper = await mountApp()
    await wrapper.find('#tab-settings').trigger('click')
    await wrapper.find('nav.page-nav').trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.find('#tab-ingest').attributes('aria-selected')).toBe('true')
  })

  it('ArrowLeft from Settings wraps to Unknown', async () => {
    const wrapper = await mountApp()
    await wrapper.find('#tab-settings').trigger('click')
    await wrapper.find('nav.page-nav').trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.find('#tab-unknown').attributes('aria-selected')).toBe('true')
  })

  it('Home jumps to the first tab (Settings)', async () => {
    const wrapper = await mountApp()
    // Default is Matches; Home should jump to Settings.
    await wrapper.find('nav.page-nav').trigger('keydown', { key: 'Home' })
    expect(wrapper.find('#tab-settings').attributes('aria-selected')).toBe('true')
  })

  it('End jumps to the last tab (Unknown)', async () => {
    const wrapper = await mountApp()
    await wrapper.find('nav.page-nav').trigger('keydown', { key: 'End' })
    expect(wrapper.find('#tab-unknown').attributes('aria-selected')).toBe('true')
  })

  it('typing into a tab without an arrow key does not change selection', async () => {
    const wrapper = await mountApp()
    await wrapper.find('nav.page-nav').trigger('keydown', { key: 'a' })
    expect(wrapper.find('#tab-matches').attributes('aria-selected')).toBe('true')
  })
})

describe('App.vue — landmarks and skip-link', () => {
  it('renders a skip-link as the first focusable, pointing at #main-content', async () => {
    const wrapper = await mountApp()
    const skip = wrapper.find('a.skip-link')
    expect(skip.exists()).toBe(true)
    expect(skip.attributes('href')).toBe('#main-content')
    // First <a>/button/input/etc in source order — keyboard users land
    // here on Tab from outside the page.
    const firstFocusable = wrapper.element.querySelector('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
    expect(firstFocusable).toBe(skip.element)
  })

  it('wraps the active view panel in a <main id="main-content">', async () => {
    const wrapper = await mountApp()
    const main = wrapper.find('main#main-content')
    expect(main.exists()).toBe(true)
    // tabindex="-1" so the skip-link can move focus to it without
    // putting <main> in the natural tab order.
    expect(main.attributes('tabindex')).toBe('-1')
    // The active panel (matches by default) is rendered inside it.
    expect(main.find('#panel-matches').exists()).toBe(true)
  })

  it('skip-link click focuses the <main> landmark', async () => {
    const wrapper = await mountApp()
    await wrapper.find('a.skip-link').trigger('click')
    expect((document.activeElement as HTMLElement | null)?.id).toBe('main-content')
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
