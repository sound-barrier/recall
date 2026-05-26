import { describe, it, expect, vi } from 'vitest'
import { useFeatureToggle, type FeatureToggleApi } from './useFeatureToggle'

function makeApi(overrides: Partial<FeatureToggleApi> = {}): FeatureToggleApi {
  return {
    set: vi.fn().mockResolvedValue(undefined),
    onError: vi.fn(),
    ...overrides,
  }
}

describe('useFeatureToggle', () => {
  it('initial state is off', () => {
    const { enabled } = useFeatureToggle(makeApi())
    expect(enabled.value).toBe(false)
  })

  it('setEnabled mirrors the persisted value (used by load())', () => {
    const { setEnabled, enabled } = useFeatureToggle(makeApi())
    setEnabled(true)
    expect(enabled.value).toBe(true)
  })

  it('toggle flips off → on and persists', async () => {
    const api = makeApi()
    const { toggle, enabled } = useFeatureToggle(api)
    await toggle()
    expect(api.set).toHaveBeenCalledWith(true)
    expect(enabled.value).toBe(true)
  })

  it('toggle flips on → off and persists', async () => {
    const api = makeApi()
    const { setEnabled, toggle, enabled } = useFeatureToggle(api)
    setEnabled(true)
    await toggle()
    expect(api.set).toHaveBeenCalledWith(false)
    expect(enabled.value).toBe(false)
  })

  it('off → on is blocked by canEnable returning a reason', async () => {
    const api = makeApi({ canEnable: () => 'configure Tesseract first' })
    const { toggle, enabled } = useFeatureToggle(api)
    await toggle()
    expect(api.set).not.toHaveBeenCalled()
    expect(enabled.value).toBe(false)
    expect(api.onError).toHaveBeenCalledWith('configure Tesseract first')
  })

  it('on → off is NOT gated by canEnable (always allow turning off)', async () => {
    const api = makeApi({ canEnable: () => 'something is wrong' })
    const { setEnabled, toggle, enabled } = useFeatureToggle(api)
    setEnabled(true)
    await toggle()
    expect(api.set).toHaveBeenCalledWith(false)
    expect(api.onError).not.toHaveBeenCalled()
    expect(enabled.value).toBe(false)
  })

  it('canEnable returning null allows the off → on transition', async () => {
    const api = makeApi({ canEnable: () => null })
    const { toggle, enabled } = useFeatureToggle(api)
    await toggle()
    expect(api.set).toHaveBeenCalledWith(true)
    expect(enabled.value).toBe(true)
  })

  it('persist failure leaves the local ref at its previous value', async () => {
    const api = makeApi({ set: vi.fn().mockRejectedValue(new Error('busy')) })
    const { toggle, enabled } = useFeatureToggle(api)
    await toggle()
    expect(enabled.value).toBe(false)
    expect(api.onError).toHaveBeenCalledWith(expect.stringContaining('busy'))
  })

  it('persist failure on a turn-off keeps the on state', async () => {
    const api = makeApi({ set: vi.fn().mockRejectedValue(new Error('busy')) })
    const { setEnabled, toggle, enabled } = useFeatureToggle(api)
    setEnabled(true)
    await toggle()
    expect(enabled.value).toBe(true)
    expect(api.onError).toHaveBeenCalled()
  })

  it('optional onError is a no-op when omitted', async () => {
    const api: FeatureToggleApi = { set: vi.fn().mockRejectedValue(new Error('x')) }
    const { toggle } = useFeatureToggle(api)
    await expect(toggle()).resolves.toBeUndefined()
  })
})
