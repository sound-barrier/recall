import { describe, it, expect, vi } from 'vitest'
import { useTesseractStatus, EMPTY_TESSERACT_STATUS, type TesseractStatusApi } from './useTesseractStatus'
import type { TesseractStatus } from '../api'

const SAMPLE: TesseractStatus = {
  path: '/usr/local/bin/tesseract',
  found: true,
  version: '5.5.1',
  supported: true,
  error: '',
  default: '/usr/bin/tesseract',
}

function makeApi(overrides: Partial<TesseractStatusApi> = {}): TesseractStatusApi {
  return {
    pickTesseractBinary: vi.fn().mockResolvedValue(SAMPLE),
    resetTesseractPath: vi.fn().mockResolvedValue(SAMPLE),
    onError: vi.fn(),
    navigateToEngine: vi.fn(),
    ...overrides,
  }
}

describe('useTesseractStatus', () => {
  it('initial status is the empty sentinel', () => {
    const api = makeApi()
    const { tesseractStatus, tesseractReady, tesseractSupported } = useTesseractStatus(api)
    expect(tesseractStatus.value).toEqual(EMPTY_TESSERACT_STATUS)
    expect(tesseractReady.value).toBe(false)
    expect(tesseractSupported.value).toBe(false)
  })

  it('setTesseractStatus updates the ref + drives computeds', () => {
    const api = makeApi()
    const { setTesseractStatus, tesseractReady, tesseractSupported } = useTesseractStatus(api)
    setTesseractStatus(SAMPLE)
    expect(tesseractReady.value).toBe(true)
    expect(tesseractSupported.value).toBe(true)
  })

  it('tesseractSupported requires both found AND supported', () => {
    const api = makeApi()
    const { setTesseractStatus, tesseractReady, tesseractSupported } = useTesseractStatus(api)
    setTesseractStatus({ ...SAMPLE, supported: false })
    expect(tesseractReady.value).toBe(true)
    expect(tesseractSupported.value).toBe(false)
  })

  it('pickTesseractBinary stores the returned status', async () => {
    const api = makeApi()
    const { pickTesseractBinary, tesseractStatus } = useTesseractStatus(api)
    await pickTesseractBinary()
    expect(api.pickTesseractBinary).toHaveBeenCalled()
    expect(tesseractStatus.value).toEqual(SAMPLE)
  })

  it('pickTesseractBinary is debounced by tesseractPickerBusy', async () => {
    let resolveFirst: (s: TesseractStatus) => void = () => {}
    const api = makeApi({
      pickTesseractBinary: vi.fn().mockImplementation(
        () => new Promise<TesseractStatus>(r => { resolveFirst = r }),
      ),
    })
    const { pickTesseractBinary, tesseractPickerBusy } = useTesseractStatus(api)
    void pickTesseractBinary()
    expect(tesseractPickerBusy.value).toBe(true)
    void pickTesseractBinary() // should no-op
    expect(api.pickTesseractBinary).toHaveBeenCalledTimes(1)
    resolveFirst(SAMPLE)
  })

  it('pickTesseractBinary failure forwards to onError + resets busy flag', async () => {
    const api = makeApi({ pickTesseractBinary: vi.fn().mockRejectedValue(new Error('cancelled')) })
    const { pickTesseractBinary, tesseractPickerBusy } = useTesseractStatus(api)
    await pickTesseractBinary()
    expect(api.onError).toHaveBeenCalledWith(expect.stringContaining('cancelled'))
    expect(tesseractPickerBusy.value).toBe(false)
  })

  it('resetTesseractPath stores the returned status', async () => {
    const api = makeApi()
    const { resetTesseractPath, tesseractStatus } = useTesseractStatus(api)
    await resetTesseractPath()
    expect(api.resetTesseractPath).toHaveBeenCalled()
    expect(tesseractStatus.value).toEqual(SAMPLE)
  })

  it('resetTesseractPath failure forwards to onError', async () => {
    const api = makeApi({ resetTesseractPath: vi.fn().mockRejectedValue(new Error('no default')) })
    const { resetTesseractPath } = useTesseractStatus(api)
    await resetTesseractPath()
    expect(api.onError).toHaveBeenCalledWith(expect.stringContaining('no default'))
  })

  it('null return leaves the status untouched', async () => {
    const api = makeApi({
      pickTesseractBinary: vi.fn().mockResolvedValue(null),
      resetTesseractPath: vi.fn().mockResolvedValue(null),
    })
    const { pickTesseractBinary, resetTesseractPath, setTesseractStatus, tesseractStatus } = useTesseractStatus(api)
    setTesseractStatus(SAMPLE)
    await pickTesseractBinary()
    expect(tesseractStatus.value).toEqual(SAMPLE)
    await resetTesseractPath()
    expect(tesseractStatus.value).toEqual(SAMPLE)
  })

  it('gotoEngineSettings calls the navigation hook', async () => {
    const api = makeApi()
    const { gotoEngineSettings } = useTesseractStatus(api)
    await gotoEngineSettings()
    expect(api.navigateToEngine).toHaveBeenCalled()
  })

  it('optional callbacks are no-ops when omitted', async () => {
    const api: TesseractStatusApi = {
      pickTesseractBinary: vi.fn().mockRejectedValue(new Error('x')),
      resetTesseractPath: vi.fn().mockRejectedValue(new Error('x')),
    }
    const { pickTesseractBinary, resetTesseractPath, gotoEngineSettings } = useTesseractStatus(api)
    await expect(pickTesseractBinary()).resolves.toBeUndefined()
    await expect(resetTesseractPath()).resolves.toBeUndefined()
    await expect(gotoEngineSettings()).resolves.toBeUndefined()
  })
})
