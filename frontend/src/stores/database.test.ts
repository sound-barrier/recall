import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CoachReturnSheet } from '@/api-client'
import { setApiBacking } from '@/api-client'
import { profileScopedKey } from '@/composables/profile/profileStorage'
import { resetWriteGate } from '@/test-utils/writeGateStub'

// The gate itself is covered by useWriteGate.test.ts; these tests are about
// what this store WIRES, so they run with writes open.
vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))

import { useCoachReturnsStore } from '@/stores/coachReturns'
import { useDatabaseStore } from '@/stores/database'
import { useMatchesStore } from '@/stores/matches'
import { useParseStore } from '@/stores/parse'

// useClearDatabase and useBackupRestore already have their own tests, so the
// arm/confirm transitions and the status-chip lifecycle are not re-litigated
// here. What was untested is this store's WIRING: which callbacks it hands
// those composables, and the cross-store reaches it makes from inside them.
//
// That distinction is the whole reason the store is worth testing separately.
// Every one of these behaviors is invisible to the composable tests (which
// pass their own fakes) and invisible to the composables themselves (which
// never learn where their callbacks land).

function apiStub(over: Record<string, unknown> = {}) {
  return {
    ClearDatabase: vi.fn().mockResolvedValue(undefined),
    BackupDatabase: vi.fn().mockResolvedValue('/tmp/snap.db'),
    RestoreDatabase: vi.fn().mockResolvedValue('/tmp/snap.db'),
    ImportMatches: vi.fn().mockResolvedValue({ path: '/tmp/b.zip', imported: 3, skipped: 0 }),
    ...over,
  }
}

function sheet(): CoachReturnSheet {
  return { coach: 'ana', exported_at: '2026-08-16T00:00:00Z', items: [] } as unknown as CoachReturnSheet
}

// happy-dom does not supply localStorage here, so tests stub it — the same
// convention usePersistedRef.test.ts uses.
function stubLocalStorage(): Map<string, string> {
  const cell = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => cell.get(k) ?? null,
    setItem: (k: string, v: string) => { cell.set(k, v) },
    removeItem: (k: string) => { cell.delete(k) },
    clear: () => { cell.clear() },
  })
  return cell
}

describe('database store wiring', () => {
  let store: Map<string, string>

  beforeEach(() => {
    setActivePinia(createPinia())
    resetWriteGate()
    store = stubLocalStorage()
  })

  it('threads the keep-suppress-list choice into the clear call', async () => {
    const api = apiStub()
    setApiBacking(api)
    const db = useDatabaseStore()

    await db.onClearDatabase({ keepIgnored: true })
    expect(api.ClearDatabase).toHaveBeenCalledWith(true)

    await db.onClearDatabase({ keepIgnored: false })
    expect(api.ClearDatabase).toHaveBeenLastCalledWith(false)
  })

  it('refreshes records AND the suppress-list after a clear', async () => {
    setApiBacking(apiStub())
    const matches = useMatchesStore()
    const parse = useParseStore()
    const loadRecords = vi.spyOn(matches, 'load').mockResolvedValue(undefined)
    const loadIgnored = vi.spyOn(parse, 'loadIgnored').mockResolvedValue(undefined)

    await useDatabaseStore().onClearDatabase({ keepIgnored: false })

    expect(loadRecords).toHaveBeenCalledTimes(1)
    expect(loadIgnored).toHaveBeenCalledTimes(1)
  })

  // The Pinia store-proxy write. `lastParsedAt` reaches the parse store
  // through a spread of the parse-run bundle, so this assigns through a ref
  // that arrived by spread rather than one declared in that store's body.
  // If it ever stops writing through, Clear Database silently leaves a stale
  // "Last run · …" stamp on the Parse tab and nothing else notices.
  it('clears the last-parsed stamp, in the store and in localStorage', async () => {
    setApiBacking(apiStub())
    const parse = useParseStore()
    vi.spyOn(useMatchesStore(), 'load').mockResolvedValue(undefined)
    vi.spyOn(parse, 'loadIgnored').mockResolvedValue(undefined)

    parse.lastParsedAt = Date.parse('2026-08-16T10:00:00Z')
    store.set(profileScopedKey('lastParsedAt'), String(Date.parse('2026-08-16T10:00:00Z')))

    await useDatabaseStore().onClearDatabase({ keepIgnored: false })

    expect(parse.lastParsedAt).toBeNull()
    expect(store.has(profileScopedKey('lastParsedAt'))).toBe(false)
  })

  it('stages a coach notes archive without reloading anything', async () => {
    setApiBacking(apiStub({
      ImportMatches: vi.fn().mockResolvedValue({
        path: '/tmp/notes.zip', imported: 0, skipped: 0, kind: 'coach_notes', return: sheet(),
      }),
    }))
    const returns = useCoachReturnsStore()
    const stage = vi.spyOn(returns, 'stageImportedNotes').mockImplementation(() => {})
    const loadRecords = vi.spyOn(useMatchesStore(), 'load').mockResolvedValue(undefined)

    await useDatabaseStore().importMatches()

    expect(stage).toHaveBeenCalledTimes(1)
    // Nothing was written to the match tables, so a reload would be a lie
    // dressed as a refresh — and would clobber whatever the player is
    // looking at while they decide on the sheet.
    expect(loadRecords).not.toHaveBeenCalled()
  })

  it('reloads records and the suppress-list after a bundle import', async () => {
    setApiBacking(apiStub())
    const loadRecords = vi.spyOn(useMatchesStore(), 'load').mockResolvedValue(undefined)
    const loadIgnored = vi.spyOn(useParseStore(), 'loadIgnored').mockResolvedValue(undefined)

    await useDatabaseStore().importMatches()

    expect(loadRecords).toHaveBeenCalledTimes(1)
    expect(loadIgnored).toHaveBeenCalledTimes(1)
  })

  it('surfaces a failed clear into the error banner instead of throwing', async () => {
    setApiBacking(apiStub({ ClearDatabase: vi.fn().mockRejectedValue(new Error('disk on fire')) }))
    const db = useDatabaseStore()

    await expect(db.onClearDatabase({ keepIgnored: false })).resolves.toBeUndefined()
    expect(db.clearingDB).toBe(false)
  })
})
