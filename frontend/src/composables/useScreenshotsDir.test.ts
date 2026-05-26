import { describe, it, expect, vi, afterEach } from 'vitest'
import { useScreenshotsDir, type ScreenshotsDirApi, type ProbeResult } from './useScreenshotsDir'

function makeApi(overrides: Partial<ScreenshotsDirApi> = {}): ScreenshotsDirApi {
  return {
    pickScreenshotsDir: vi.fn().mockResolvedValue('/picked/path'),
    probeScreenshotsDir: vi.fn().mockResolvedValue({ found: true, path: '/probed/path', tried: ['/a', '/b'] } satisfies ProbeResult),
    setScreenshotsDir: vi.fn().mockResolvedValue(undefined),
    refreshNewCount: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  }
}

describe('useScreenshotsDir', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('initial screenshotsDir is empty string', () => {
    const api = makeApi()
    const { screenshotsDir, probing, probeStatus } = useScreenshotsDir(api)
    expect(screenshotsDir.value).toBe('')
    expect(probing.value).toBe(false)
    expect(probeStatus.value).toBe('')
  })

  it('setScreenshotsDir stores the value (used by load())', () => {
    const api = makeApi()
    const { setScreenshotsDir, screenshotsDir } = useScreenshotsDir(api)
    setScreenshotsDir('/already/persisted')
    expect(screenshotsDir.value).toBe('/already/persisted')
  })

  it('pickDir updates the dir + calls refreshNewCount on success', async () => {
    const api = makeApi()
    const { pickDir, screenshotsDir } = useScreenshotsDir(api)
    await pickDir()
    expect(api.pickScreenshotsDir).toHaveBeenCalled()
    expect(screenshotsDir.value).toBe('/picked/path')
    expect(api.refreshNewCount).toHaveBeenCalled()
  })

  it('pickDir with empty return (user cancel) leaves the value unchanged', async () => {
    const api = makeApi({ pickScreenshotsDir: vi.fn().mockResolvedValue('') })
    const { pickDir, setScreenshotsDir, screenshotsDir } = useScreenshotsDir(api)
    setScreenshotsDir('/existing')
    await pickDir()
    expect(screenshotsDir.value).toBe('/existing')
    // refreshNewCount still fires (the cancel path is silent at the
    // composable layer; the API decides whether to short-circuit).
    expect(api.refreshNewCount).toHaveBeenCalled()
  })

  it('pickDir failure forwards to onError', async () => {
    const api = makeApi({ pickScreenshotsDir: vi.fn().mockRejectedValue(new Error('eperm')) })
    const { pickDir } = useScreenshotsDir(api)
    await pickDir()
    expect(api.onError).toHaveBeenCalledWith(expect.stringContaining('eperm'))
  })

  it('pickDir aborts when shouldConfirmPickWhile is true and user declines', async () => {
    const confirmFn = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirmFn)
    const api = makeApi({ shouldConfirmPickWhile: () => true })
    const { pickDir } = useScreenshotsDir(api)
    await pickDir()
    expect(confirmFn).toHaveBeenCalled()
    expect(api.pickScreenshotsDir).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('pickDir proceeds when shouldConfirmPickWhile is true and user accepts', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    const api = makeApi({ shouldConfirmPickWhile: () => true })
    const { pickDir, screenshotsDir } = useScreenshotsDir(api)
    await pickDir()
    expect(api.pickScreenshotsDir).toHaveBeenCalled()
    expect(screenshotsDir.value).toBe('/picked/path')
    vi.unstubAllGlobals()
  })

  it('pickDir skips the confirm when shouldConfirmPickWhile returns false', async () => {
    const confirmFn = vi.fn()
    vi.stubGlobal('confirm', confirmFn)
    const api = makeApi({ shouldConfirmPickWhile: () => false })
    const { pickDir } = useScreenshotsDir(api)
    await pickDir()
    expect(confirmFn).not.toHaveBeenCalled()
    expect(api.pickScreenshotsDir).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('detectDir success updates dir, probeStatus, and probeMessage', async () => {
    const api = makeApi()
    const { detectDir, screenshotsDir, probeStatus, probeMessage, probeTried, probing } = useScreenshotsDir(api)
    const p = detectDir()
    expect(probing.value).toBe(true)
    await p
    expect(api.probeScreenshotsDir).toHaveBeenCalled()
    expect(api.setScreenshotsDir).toHaveBeenCalledWith('/probed/path')
    expect(screenshotsDir.value).toBe('/probed/path')
    expect(probeStatus.value).toBe('success')
    expect(probeMessage.value).toContain('/probed/path')
    expect(probeTried.value).toEqual(['/a', '/b'])
    expect(probing.value).toBe(false)
  })

  it('detectDir not-found sets blocked + helpful message', async () => {
    const api = makeApi({ probeScreenshotsDir: vi.fn().mockResolvedValue({ found: false, tried: ['/a'] }) })
    const { detectDir, probeStatus, probeMessage } = useScreenshotsDir(api)
    await detectDir()
    expect(probeStatus.value).toBe('blocked')
    expect(probeMessage.value).toMatch(/No default Overwatch folder/i)
    expect(api.setScreenshotsDir).not.toHaveBeenCalled()
  })

  it('detectDir failure sets blocked + the thrown message', async () => {
    const api = makeApi({ probeScreenshotsDir: vi.fn().mockRejectedValue(new Error('platform unsupported')) })
    const { detectDir, probeStatus, probeMessage, probing } = useScreenshotsDir(api)
    await detectDir()
    expect(probeStatus.value).toBe('blocked')
    expect(probeMessage.value).toContain('platform unsupported')
    expect(probing.value).toBe(false)
  })
})
