import { describe, it, expect, vi } from 'vitest'
import { useClearDatabase, type ClearDatabaseApi } from './useClearDatabase'

function makeApi(overrides: Partial<ClearDatabaseApi> = {}): ClearDatabaseApi {
  return {
    clearDatabase: vi.fn().mockResolvedValue(undefined),
    afterClear: vi.fn(),
    resetLastParsedAt: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  }
}

describe('useClearDatabase', () => {
  it('armClear flips clearConfirm without calling the API', () => {
    const api = makeApi()
    const { armClear, clearConfirm } = useClearDatabase(api)
    armClear()
    expect(clearConfirm.value).toBe(true)
    expect(api.clearDatabase).not.toHaveBeenCalled()
  })

  it('cancelClear disarms without calling the API', () => {
    const api = makeApi()
    const { armClear, cancelClear, clearConfirm } = useClearDatabase(api)
    armClear()
    cancelClear()
    expect(clearConfirm.value).toBe(false)
    expect(api.clearDatabase).not.toHaveBeenCalled()
  })

  it('clearDatabase clears, refreshes, and resets lastParsedAt on success', async () => {
    const api = makeApi()
    const { clearDatabase, clearingDB, clearConfirm } = useClearDatabase(api)
    const p = clearDatabase()
    expect(clearingDB.value).toBe(true)
    expect(clearConfirm.value).toBe(false) // disarms while in flight
    await p
    expect(api.clearDatabase).toHaveBeenCalled()
    expect(api.afterClear).toHaveBeenCalled()
    expect(api.resetLastParsedAt).toHaveBeenCalled()
    expect(clearingDB.value).toBe(false)
  })

  it('failure surfaces via onError and does not call resetLastParsedAt', async () => {
    const api = makeApi({ clearDatabase: vi.fn().mockRejectedValue(new Error('locked')) })
    const { clearDatabase, clearingDB } = useClearDatabase(api)
    await clearDatabase()
    expect(api.onError).toHaveBeenCalledWith(expect.stringContaining('locked'))
    expect(api.resetLastParsedAt).not.toHaveBeenCalled()
    expect(api.afterClear).not.toHaveBeenCalled()
    expect(clearingDB.value).toBe(false)
  })

  it('optional callbacks are no-ops when omitted', async () => {
    const api: ClearDatabaseApi = {
      clearDatabase: vi.fn().mockRejectedValue(new Error('x')),
      afterClear: vi.fn(),
    }
    const { clearDatabase } = useClearDatabase(api)
    // Must not throw on undefined onError / resetLastParsedAt.
    await expect(clearDatabase()).resolves.toBeUndefined()
  })

  it('arming after a successful clear leaves clearConfirm in the right state', async () => {
    const api = makeApi()
    const { clearDatabase, armClear, clearConfirm } = useClearDatabase(api)
    await clearDatabase()
    expect(clearConfirm.value).toBe(false)
    armClear()
    expect(clearConfirm.value).toBe(true)
  })
})
