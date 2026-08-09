import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import UnknownFailedSection from '@/components/unknown/UnknownFailedSection.vue'
import { useMatchesStore } from '@/stores/matches'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'
import { ExportDiagnosticBundle, IgnoreScreenshot } from '@/api'
import type { FailedFile } from '@/api'

// The section reads matchesStore.failedFiles directly and suppresses via
// useMatchActions' onIgnoreScreenshot. Keep '@/api' real except the calls
// the store's reload paths + the ignore action would hit.
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  GetMatchResults:        vi.fn(async () => []),
  GetNewScreenshotCount:  vi.fn(async () => 0),
  GetFailedFiles:         vi.fn(async () => []),
  GetIgnoredScreenshots:  vi.fn(async () => []),
  IgnoreScreenshot:       vi.fn(async () => undefined),
  ExportDiagnosticBundle: vi.fn(async () => 'recall-diagnostic-x.zip'),
}))

afterEach(() => {
  vi.clearAllMocks()
})

const row = (over: Partial<FailedFile> = {}): FailedFile => ({
  filename: 'corrupt.png',
  error: 'decoding image: png: invalid format',
  attempts: 6,
  first_failed_at: '2026-07-01T20:00:00Z',
  last_failed_at: '2026-07-06T21:30:00Z',
  ...over,
})

function mountWith(rows: FailedFile[]) {
  setActivePinia(createPinia())
  // Seed BEFORE the store exists: pre-seeded data is fresh (staleTime is
  // Infinity), so the store's observer never fires the initial fetch that
  // would otherwise clobber the seed when its mock resolves.
  seedQuery(qk.failedFiles, rows)
  useMatchesStore()
  return mount(UnknownFailedSection)
}

describe('UnknownFailedSection', () => {
  it('renders nothing when the ledger is empty', () => {
    const wrapper = mountWith([])
    expect(wrapper.find('#section-failed').exists()).toBe(false)
  })

  it('lists filename, error, and attempt tally', () => {
    const wrapper = mountWith([row()])
    const section = wrapper.find('#section-failed')
    expect(section.exists()).toBe(true)
    expect(section.text()).toContain('Failed to read (1)')
    expect(section.text()).toContain('corrupt.png')
    expect(section.text()).toContain('decoding image: png: invalid format')
    expect(section.text()).toContain('6 attempts')
    expect(section.text()).toMatch(/retried on every parse run/i)
  })

  it('the bundle button calls the export and reports the saved name', async () => {
    const wrapper = mountWith([row()])
    const btn = wrapper.find('[data-diagnostic-bundle]')
    expect(btn.exists()).toBe(true)

    await btn.trigger('click')
    await new Promise((r) => setTimeout(r))
    expect(ExportDiagnosticBundle).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Saved recall-diagnostic-x.zip')
  })

  it('a Wails dialog cancel (empty name) stays silent', async () => {
    vi.mocked(ExportDiagnosticBundle).mockResolvedValueOnce('')
    const wrapper = mountWith([row()])
    await wrapper.find('[data-diagnostic-bundle]').trigger('click')
    await new Promise((r) => setTimeout(r))
    expect(wrapper.text()).not.toContain('Saved')
  })

  it('two-click Delete forever fires IgnoreScreenshot only on confirm', async () => {
    const wrapper = mountWith([row()])
    const btn = wrapper.find('[data-failed-ignore="corrupt.png"]')

    await btn.trigger('click')
    expect(btn.text()).toMatch(/Confirm delete\?/i)
    expect(IgnoreScreenshot).not.toHaveBeenCalled()

    await btn.trigger('click')
    expect(IgnoreScreenshot).toHaveBeenCalledWith('corrupt.png')
  })
})
