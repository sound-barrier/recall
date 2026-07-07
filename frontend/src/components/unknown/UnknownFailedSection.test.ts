import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import UnknownFailedSection from '@/components/unknown/UnknownFailedSection.vue'
import { useMatchesStore } from '@/stores/matches'
import { IgnoreScreenshot } from '@/api'
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
  const matches = useMatchesStore()
  matches.failedFiles = rows
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
