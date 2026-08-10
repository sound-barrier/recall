import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'

// The singleton caches its fetch across a page load, so each test resets the
// module registry and re-imports with its own GetProfiles mock.
describe('useActiveProfile', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  async function load(mockGetProfiles: () => Promise<unknown>) {
    vi.doMock('@/api-client', () => ({ GetProfiles: vi.fn(mockGetProfiles) }))
    const { useActiveProfile } = await import('@/composables/shared/useActiveProfile')
    const api = useActiveProfile()
    await flushPromises()
    // The profiles query settles through the notifyManager's scheduling —
    // a macrotask tick, not just microtask flushing.
    await new Promise(r => setTimeout(r, 0))
    return api
  }

  it('flags a read-only active profile', async () => {
    const { isReadOnly } = await load(async () => ({
      active: 'test', profiles: ['main', 'test'], immutable: ['test'],
    }))
    expect(isReadOnly.value).toBe(true)
  })

  it('leaves a normal profile mutable', async () => {
    const { isReadOnly } = await load(async () => ({
      active: 'main', profiles: ['main', 'test'], immutable: ['test'],
    }))
    expect(isReadOnly.value).toBe(false)
  })

  it('tolerates a response with no immutable field', async () => {
    const { isReadOnly } = await load(async () => ({ active: 'test', profiles: ['test'] }))
    expect(isReadOnly.value).toBe(false)
  })

  it('defaults to mutable when the fetch fails', async () => {
    const { isReadOnly } = await load(async () => { throw new Error('offline') })
    expect(isReadOnly.value).toBe(false)
  })
})
