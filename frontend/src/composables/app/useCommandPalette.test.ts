import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

import type { MatchRecord } from '@/api-client'
import { useCommandPalette } from '@/composables/app/useCommandPalette'
import { useMatchesStore } from '@/stores/matches'
import { useUiStore } from '@/stores/ui'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'

// The palette's contract is narrow and its failure mode is not: every result
// it offers must be something the app can actually go to. A result that
// resolves to nothing opens the detail panel with no record in it, which
// renders no modal at all while still marking the page inert — a window that
// silently stops responding, with no visible modal to close.

function rec(key: string, over: Record<string, unknown> = {}): MatchRecord {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: { map: 'rialto', hero: 'lucio', result: 'victory', date: '2026-08-10', finished_at: '20:00', ...over },
  } as unknown as MatchRecord
}

async function setup(records: MatchRecord[]) {
  seedQuery(qk.matches, records)
  const matches = useMatchesStore()
  const ui = useUiStore()
  await nextTick()
  return { palette: useCommandPalette(), matches, ui }
}

describe('useCommandPalette', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('finds a match by its hero', async () => {
    const { palette } = await setup([rec('m1', { hero: 'juno' })])

    palette.query.value = 'juno'
    await nextTick()

    expect(palette.results.value.some((r) => r.target === 'm1')).toBe(true)
  })

  // The freeze. An unknown-map match is excluded from the narrowed set by
  // default, and the detail panel paginates against exactly that set — so
  // offering one as a result meant Enter set isOpen with no record behind it.
  it('never offers a match the detail panel cannot open', async () => {
    const { palette, matches } = await setup([
      rec('visible', { hero: 'juno' }),
      rec('unknown-map', { hero: 'juno', map: '' }),
    ])
    const reachable = new Set(
      matches.matchesNarrow.narrowedRecords.value.map((r) => r.match_key),
    )

    palette.query.value = 'juno'
    await nextTick()

    for (const result of palette.results.value) {
      if (result.kind !== 'match') continue
      expect(reachable.has(result.target)).toBe(true)
    }
  })

  it('opens the match the user chose', async () => {
    const { palette, ui } = await setup([rec('m1', { hero: 'juno' })])

    palette.query.value = 'juno'
    await nextTick()
    palette.run()

    expect(ui.selection.isOpen.value).toBe(true)
    expect(ui.selection.selectedRecord.value?.match_key).toBe('m1')
  })

  // Typing narrows the list under the cursor. Leaving the cursor where it was
  // means the highlight lands past the end: nothing appears selected, and
  // Enter runs a row the user never pointed at.
  it('returns the cursor to the top when the query changes', async () => {
    const { palette } = await setup([rec('m1', { hero: 'juno' }), rec('m2', { hero: 'ana' })])

    palette.move(1)
    palette.move(1)
    palette.query.value = 'juno'
    await nextTick()

    expect(palette.cursor.value).toBe(0)
    expect(palette.results.value[palette.cursor.value]).toBeDefined()
  })
})
