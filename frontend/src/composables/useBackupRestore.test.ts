import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useBackupRestore, type BackupRestoreApi } from './useBackupRestore'

function makeApi(overrides: Partial<BackupRestoreApi> = {}): BackupRestoreApi {
  return {
    exportJSON: vi.fn().mockResolvedValue('/tmp/export.json'),
    exportCSV: vi.fn().mockResolvedValue('/tmp/export.csv'),
    importJSON: vi.fn().mockResolvedValue('/tmp/import.json'),
    afterImport: vi.fn(),
    ...overrides,
  }
}

describe('useBackupRestore', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('exportData(json) sets a Saved chip on success', async () => {
    const api = makeApi()
    const { exportData, exportStatus, exporting } = useBackupRestore(api)
    const p = exportData()
    expect(exporting.value).toBe('json')
    await p
    expect(api.exportJSON).toHaveBeenCalled()
    expect(exporting.value).toBe(false)
    expect(exportStatus.value).toEqual({ ok: true, message: 'Saved: /tmp/export.json' })
  })

  it('exportDataCSV uses the CSV path', async () => {
    const api = makeApi()
    const { exportDataCSV, exportStatus } = useBackupRestore(api)
    await exportDataCSV()
    expect(api.exportCSV).toHaveBeenCalled()
    expect(api.exportJSON).not.toHaveBeenCalled()
    expect(exportStatus.value?.message).toContain('export.csv')
  })

  it('empty path (user cancel) leaves the chip silent', async () => {
    const api = makeApi({ exportJSON: vi.fn().mockResolvedValue('') })
    const { exportData, exportStatus } = useBackupRestore(api)
    await exportData()
    expect(exportStatus.value).toBeNull()
  })

  it('failure surfaces an error chip', async () => {
    const api = makeApi({ exportJSON: vi.fn().mockRejectedValue(new Error('disk full')) })
    const { exportData, exportStatus, exporting } = useBackupRestore(api)
    await exportData()
    expect(exporting.value).toBe(false)
    expect(exportStatus.value?.ok).toBe(false)
    expect(exportStatus.value?.message).toContain('disk full')
  })

  it('concurrent export call is rejected while one is in flight', async () => {
    let resolveFirst: (s: string) => void = () => {}
    const api = makeApi({
      exportJSON: vi.fn().mockImplementation(() => new Promise<string>(r => { resolveFirst = r })),
    })
    const { exportData, exporting } = useBackupRestore(api)
    void exportData()
    expect(exporting.value).toBe('json')
    void exportData() // second call: should no-op
    expect(api.exportJSON).toHaveBeenCalledTimes(1)
    resolveFirst('/tmp/a.json')
  })

  it('chip auto-clears after 5s', async () => {
    const api = makeApi()
    const { exportData, exportStatus } = useBackupRestore(api)
    await exportData()
    expect(exportStatus.value).not.toBeNull()
    vi.advanceTimersByTime(4999)
    expect(exportStatus.value).not.toBeNull()
    vi.advanceTimersByTime(2)
    expect(exportStatus.value).toBeNull()
  })

  it('a newer chip does not get clobbered by an older auto-clear timer', async () => {
    const api = makeApi()
    const { exportData, exportStatus } = useBackupRestore(api)
    await exportData()
    const first = exportStatus.value
    vi.advanceTimersByTime(2000)
    // Replace with a fresh chip mid-window.
    await exportData()
    const second = exportStatus.value
    expect(second).not.toBe(first)
    // Original auto-clear fires (5s after the first chip) — should
    // see that the chip has been replaced and skip.
    vi.advanceTimersByTime(3000)
    expect(exportStatus.value).toBe(second)
  })

  it('importData arms-then-import sets a Imported chip and calls afterImport', async () => {
    const api = makeApi()
    const { armImport, importData, importArmed, exportStatus, importing } = useBackupRestore(api)
    armImport()
    expect(importArmed.value).toBe(true)
    const p = importData()
    expect(importing.value).toBe(true)
    expect(importArmed.value).toBe(false) // disarmed once import starts
    await p
    expect(api.importJSON).toHaveBeenCalled()
    expect(api.afterImport).toHaveBeenCalled()
    expect(exportStatus.value?.message).toContain('Imported')
  })

  it('cancelImport disarms without firing import', () => {
    const api = makeApi()
    const { armImport, cancelImport, importArmed } = useBackupRestore(api)
    armImport()
    cancelImport()
    expect(importArmed.value).toBe(false)
    expect(api.importJSON).not.toHaveBeenCalled()
  })

  it('arm-import clears the chip so the previous Saved message goes away', async () => {
    const api = makeApi()
    const { exportData, armImport, exportStatus } = useBackupRestore(api)
    await exportData()
    expect(exportStatus.value).not.toBeNull()
    armImport()
    expect(exportStatus.value).toBeNull()
  })

  it('import failure surfaces an error chip and skips afterImport', async () => {
    const api = makeApi({ importJSON: vi.fn().mockRejectedValue(new Error('schema mismatch')) })
    const { importData, exportStatus, importing } = useBackupRestore(api)
    await importData()
    expect(importing.value).toBe(false)
    expect(exportStatus.value?.ok).toBe(false)
    expect(exportStatus.value?.message).toContain('schema mismatch')
    expect(api.afterImport).not.toHaveBeenCalled()
  })

  it('importData with empty path stays silent (no chip, no afterImport)', async () => {
    const api = makeApi({ importJSON: vi.fn().mockResolvedValue('') })
    const { importData, exportStatus } = useBackupRestore(api)
    await importData()
    expect(exportStatus.value).toBeNull()
    expect(api.afterImport).not.toHaveBeenCalled()
  })
})
