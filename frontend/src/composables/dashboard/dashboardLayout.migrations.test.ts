import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  runLayoutMigrationsOnce,
  CURRENT_LAYOUT_VERSION,
  LAYOUT_STORAGE_KEY,
  LAYOUT_VERSION_KEY,
  type RowLayout,
} from '@/composables/dashboard/dashboardLayout.migrations'

// The v3 step exists because adding an id to DEFAULT_ROW_LAYOUT reaches NOBODY
// who has already launched the app: the version guard returns early, and
// reconcile() deliberately never re-adds an absent default (otherwise trashing
// a widget would lose to a stale re-add pass). Without a migration, two users
// on the identical build get different dossiers, decided by when they last
// opened the app — which is the kind of difference nobody can debug from a
// screenshot.
function stub(initial: Record<string, string> = {}) {
  const cell = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => cell.get(k) ?? null,
    setItem: (k: string, v: string) => { cell.set(k, v) },
    removeItem: (k: string) => { cell.delete(k) },
    clear: () => { cell.clear() },
  })
  return cell
}

const read = (cell: Map<string, string>): RowLayout =>
  JSON.parse(cell.get(LAYOUT_STORAGE_KEY) ?? '{}') as RowLayout

describe('layout migration v3 — Ranked above', () => {
  beforeEach(() => { vi.unstubAllGlobals() })

  it('inserts the widget beside Current rank for a user already on v2', () => {
    const cell = stub({
      [LAYOUT_VERSION_KEY]: '2',
      [LAYOUT_STORAGE_KEY]: JSON.stringify({
        1: ['winrate'],
        2: ['current-rank', 'winrate-by-hero'],
      }),
    })

    runLayoutMigrationsOnce()

    // Beside the reading it qualifies, not appended at the end of the row.
    expect(read(cell)[2]).toEqual(['current-rank', 'rank-percentile', 'winrate-by-hero'])
    expect(cell.get(LAYOUT_VERSION_KEY)).toBe(String(CURRENT_LAYOUT_VERSION))
  })

  it('does not duplicate it for a user who already added it by hand', () => {
    const cell = stub({
      [LAYOUT_VERSION_KEY]: '2',
      [LAYOUT_STORAGE_KEY]: JSON.stringify({ 2: ['rank-percentile', 'current-rank'] }),
    })

    runLayoutMigrationsOnce()

    expect(read(cell)[2]).toEqual(['rank-percentile', 'current-rank'])
  })

  // A user can trash Current rank. The widget still has to land somewhere
  // sensible rather than inventing a row of its own.
  it('falls back to the breakdown row when Current rank is absent', () => {
    const cell = stub({
      [LAYOUT_VERSION_KEY]: '2',
      [LAYOUT_STORAGE_KEY]: JSON.stringify({ 1: ['winrate'], 2: ['winrate-by-map'] }),
    })

    runLayoutMigrationsOnce()

    expect(read(cell)[2]).toEqual(['winrate-by-map', 'rank-percentile'])
  })

  it('is a no-op once the version is stamped', () => {
    const cell = stub({
      [LAYOUT_VERSION_KEY]: String(CURRENT_LAYOUT_VERSION),
      [LAYOUT_STORAGE_KEY]: JSON.stringify({ 2: ['current-rank'] }),
    })

    runLayoutMigrationsOnce()

    expect(read(cell)[2]).toEqual(['current-rank'])
  })
})
