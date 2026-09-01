import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MatchRecord } from '@/api-client'
import { setApiBacking } from '@/api-client'
import { useSeasonRecap } from '@/composables/compare/useSeasonRecap'
import type { Season } from '@/composables/shared/useOWData'
import { installMemoryLocalStorage } from '@/test-utils'

// The rollover detector, which is the only stateful thing here. Everything
// else about the recap is a pure builder tested beside it.
//
// It is local by necessity: the update check is permanently disabled under
// the no-network-on-mount rule, and a season's `end` in seasons.yaml is an
// explicit ESTIMATE, so "has a season ended" cannot be read off either.

const S3: Season = {
  name: 'Season 3', chapter: 'C', number: 3,
  start: '2026-06-16T19:00:00Z', end: '2026-08-11T19:00:00Z',
}
const S4: Season = {
  name: 'Season 4', chapter: 'C', number: 4,
  start: '2026-08-11T19:00:00Z', end: '2026-10-13T19:00:00Z',
}

const IN_S4 = Date.parse('2026-09-01T12:00:00Z')
const records: MatchRecord[] = []

const api = { ExportWebPage: vi.fn(async () => 'recall-recap-season-4.html') }

function recap(now = IN_S4) {
  return useSeasonRecap(() => records, () => [S3, S4], () => now)
}

beforeEach(() => {
  installMemoryLocalStorage()
  vi.clearAllMocks()
  setApiBacking(api)
})

afterEach(async () => { await vi.dynamicImportSettled() })

describe('useSeasonRecap', () => {
  it('says nothing on a first run, when every season is new', () => {
    // Greeting a fresh install with a recap of a season it has no matches
    // from is a worse first impression than silence.
    expect(recap().endedSeason.value).toBeNull()
  })

  it('seeds the marker on a first run so the first rollover seen is a real one', () => {
    const r = recap()
    r.seedIfUnseen()
    expect(localStorage.getItem('recall.lastSeenSeason')).toBe('Season 4')
    expect(r.endedSeason.value).toBeNull()
  })

  it('names the season that ended once the calendar has moved on', () => {
    localStorage.setItem('recall.lastSeenSeason', 'Season 3')
    expect(recap().endedSeason.value?.name).toBe('Season 3')
  })

  it('stays quiet while the season it last saw is still running', () => {
    localStorage.setItem('recall.lastSeenSeason', 'Season 4')
    expect(recap().endedSeason.value).toBeNull()
  })

  it('forgets a last-seen season the roster no longer carries', () => {
    // A season renamed or dropped in a data update is not a rollover — it is
    // a season this app can no longer name, and naming it anyway would put a
    // stale string in front of the player.
    localStorage.setItem('recall.lastSeenSeason', 'Season 2')
    expect(recap().endedSeason.value).toBeNull()
  })

  it('stops asking once the notice is answered', () => {
    localStorage.setItem('recall.lastSeenSeason', 'Season 3')
    const r = recap()
    expect(r.endedSeason.value?.name).toBe('Season 3')
    r.markSeen()
    expect(r.endedSeason.value).toBeNull()
  })

  it('saves the page under the season it is about, and stops asking', async () => {
    localStorage.setItem('recall.lastSeenSeason', 'Season 3')
    const r = recap()
    await r.save(S3)

    expect(api.ExportWebPage).toHaveBeenCalledTimes(1)
    const [html, filename, dialog] = api.ExportWebPage.mock.calls[0] as unknown as string[]
    expect(html).toContain('Season 3')
    expect(filename).toBe('recall-recap-season-3.html')
    expect(dialog).toBe('Save Season 3 recap (web page)')
    expect(r.savedAs.value).toBe('recall-recap-season-4.html')
    expect(r.endedSeason.value).toBeNull()
  })

  it('surfaces a failed save rather than reporting a filename it never wrote', async () => {
    const r = recap()
    api.ExportWebPage.mockRejectedValueOnce(new Error('disk full'))
    await r.save(S4)
    expect(r.error.value).toBe('disk full')
    expect(r.savedAs.value).toBe('')
    expect(r.saving.value).toBe(false)
  })
})
