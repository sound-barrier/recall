import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useBackupRestore, type BackupRestoreApi, type MatchImportResult } from '@/composables/settings/useBackupRestore'

function result(over: Partial<MatchImportResult> = {}): MatchImportResult {
  return { path: '/tmp/bundle.zip', imported: 2, skipped: 1, ...over }
}

function makeApi(overrides: Partial<BackupRestoreApi> = {}): BackupRestoreApi {
  return {
    backup: vi.fn().mockResolvedValue('/tmp/recall-backup.db'),
    restore: vi.fn().mockResolvedValue('/tmp/recall-backup.db'),
    importMatches: vi.fn().mockResolvedValue(result()),
    reload: vi.fn(),
    ...overrides,
  }
}

describe('useBackupRestore', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('backup() sets a Saved chip on success', async () => {
    const api = makeApi()
    const { backup, status, backingUp } = useBackupRestore(api)
    const p = backup()
    expect(backingUp.value).toBe(true)
    await p
    expect(api.backup).toHaveBeenCalled()
    expect(backingUp.value).toBe(false)
    expect(status.value).toEqual({ ok: true, message: 'Saved: /tmp/recall-backup.db' })
  })

  it('backup() empty path (user cancel) leaves the chip silent', async () => {
    const api = makeApi({ backup: vi.fn().mockResolvedValue('') })
    const { backup, status } = useBackupRestore(api)
    await backup()
    expect(status.value).toBeNull()
  })

  it('backup() failure surfaces an error chip', async () => {
    const api = makeApi({ backup: vi.fn().mockRejectedValue(new Error('disk full')) })
    const { backup, status, backingUp } = useBackupRestore(api)
    await backup()
    expect(backingUp.value).toBe(false)
    expect(status.value?.ok).toBe(false)
    expect(status.value?.message).toContain('disk full')
  })

  it('a second backup is rejected while one is in flight', async () => {
    let resolveFirst: (s: string) => void = () => {}
    const api = makeApi({
      backup: vi.fn().mockImplementation(() => new Promise<string>(r => { resolveFirst = r })),
    })
    const { backup, backingUp } = useBackupRestore(api)
    void backup()
    expect(backingUp.value).toBe(true)
    void backup() // second call: should no-op
    expect(api.backup).toHaveBeenCalledTimes(1)
    resolveFirst('/tmp/a.db')
  })

  it('chip auto-clears after 5s', async () => {
    const api = makeApi()
    const { backup, status } = useBackupRestore(api)
    await backup()
    expect(status.value).not.toBeNull()
    vi.advanceTimersByTime(4999)
    expect(status.value).not.toBeNull()
    vi.advanceTimersByTime(2)
    expect(status.value).toBeNull()
  })

  it('a newer chip does not get clobbered by an older auto-clear timer', async () => {
    const api = makeApi()
    const { backup, status } = useBackupRestore(api)
    await backup()
    const first = status.value
    vi.advanceTimersByTime(2000)
    await backup()
    const second = status.value
    expect(second).not.toBe(first)
    vi.advanceTimersByTime(3000)
    expect(status.value).toBe(second)
  })

  it('restore arms-then-confirms, sets a Restored chip, and reloads', async () => {
    const api = makeApi()
    const { armRestore, restore, restoreArmed, status, restoring } = useBackupRestore(api)
    armRestore()
    expect(restoreArmed.value).toBe(true)
    const p = restore()
    expect(restoring.value).toBe(true)
    expect(restoreArmed.value).toBe(false) // disarmed once restore starts
    await p
    expect(api.restore).toHaveBeenCalled()
    expect(api.reload).toHaveBeenCalled()
    expect(status.value?.message).toContain('Restored from')
  })

  it('cancelRestore disarms without firing restore', () => {
    const api = makeApi()
    const { armRestore, cancelRestore, restoreArmed } = useBackupRestore(api)
    armRestore()
    cancelRestore()
    expect(restoreArmed.value).toBe(false)
    expect(api.restore).not.toHaveBeenCalled()
  })

  it('armRestore clears a prior chip so the Saved message goes away', async () => {
    const api = makeApi()
    const { backup, armRestore, status } = useBackupRestore(api)
    await backup()
    expect(status.value).not.toBeNull()
    armRestore()
    expect(status.value).toBeNull()
  })

  it('restore failure surfaces an error chip and skips reload', async () => {
    const api = makeApi({ restore: vi.fn().mockRejectedValue(new Error('not a database')) })
    const { restore, status, restoring } = useBackupRestore(api)
    await restore()
    expect(restoring.value).toBe(false)
    expect(status.value?.ok).toBe(false)
    expect(status.value?.message).toContain('not a database')
    expect(api.reload).not.toHaveBeenCalled()
  })

  it('importMatches sets an Imported chip with the merge counts and reloads', async () => {
    const api = makeApi()
    const { importMatches, status, importingMatches } = useBackupRestore(api)
    const p = importMatches()
    expect(importingMatches.value).toBe(true)
    await p
    expect(api.importMatches).toHaveBeenCalled()
    expect(api.reload).toHaveBeenCalled()
    expect(status.value).toEqual({ ok: true, message: 'Imported 2 matches, skipped 1 already present' })
  })

  it('importMatches with no collisions omits the skipped clause', async () => {
    const api = makeApi({ importMatches: vi.fn().mockResolvedValue(result({ imported: 1, skipped: 0 })) })
    const { importMatches, status } = useBackupRestore(api)
    await importMatches()
    expect(status.value?.message).toBe('Imported 1 match')
  })

  it('importMatches with empty path stays silent (no chip, no reload)', async () => {
    const api = makeApi({ importMatches: vi.fn().mockResolvedValue(result({ path: '' })) })
    const { importMatches, status } = useBackupRestore(api)
    await importMatches()
    expect(status.value).toBeNull()
    expect(api.reload).not.toHaveBeenCalled()
  })

  it('importMatches failure surfaces an error chip and skips reload', async () => {
    const api = makeApi({ importMatches: vi.fn().mockRejectedValue(new Error('unsupported schema')) })
    const { importMatches, status } = useBackupRestore(api)
    await importMatches()
    expect(status.value?.ok).toBe(false)
    expect(status.value?.message).toContain('unsupported schema')
    expect(api.reload).not.toHaveBeenCalled()
  })
})
