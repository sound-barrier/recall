import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

import type { MatchRecord } from '@/api-client'
import { useCommandPalette } from '@/composables/app/useCommandPalette'
import { flushPromises } from '@/test-utils'
import { ACTION_ITEMS } from '@/match/palette-items'
import { useCoachStore } from '@/stores/coach'
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

  // Actions are the palette's third kind, and the one with a way to be
  // silently wrong: a runner chosen by falling through an if/else does
  // SOMETHING for a target it does not know, and the something here opens the
  // share dialog — a surface that puts a file holding every teammate's
  // BattleTag in front of the user, for an entry they meant as anything else.
  describe('actions', () => {
    it('runs each one it offers, and only what that one does', async () => {
      const { palette, matches } = await setup([rec('m1')])
      const opened: string[] = []
      matches.onExportBundleRequest = ((keys: string[]) => { opened.push(`share:${keys.length}`) }) as never
      const coach = useCoachStore()
      coach.openBundle = (async () => { opened.push('open-bundle') }) as never

      for (const item of ACTION_ITEMS) {
        palette.run({ ...item, hits: [] })
      }
      // The share runner awaits a view change before it opens anything, so a
      // single tick is not enough — and a test that stops there reads a
      // silently-wrong runner as a correct one.
      await flushPromises()

      expect(opened).toHaveLength(ACTION_ITEMS.length)
      expect(opened).toContain('open-bundle')
      expect(opened.some((o) => o.startsWith('share:'))).toBe(true)
    })

    it('does nothing at all for an action it has no runner for', async () => {
      const { palette, matches } = await setup([rec('m1')])
      let touched = false
      matches.onExportBundleRequest = (() => { touched = true }) as never
      const coach = useCoachStore()
      coach.openBundle = (async () => { touched = true }) as never

      palette.run({
        id: 'action:not-wired', kind: 'action', label: 'Not wired',
        hint: '', target: 'not-wired', hits: [],
      })
      await flushPromises()

      expect(touched).toBe(false)
    })

    // In the Film Room the corpus is somebody ELSE's matches. "Share matches
    // with a coach" there would open the share dialog over the loaned set and
    // export whatever the coach's own database holds under those keys — and
    // "Open a player's bundle" is a 409, one session at a time. Neither is a
    // thing to offer from a room where neither can happen.
    it('offers neither coaching action inside a coaching session', async () => {
      // Seeded before the store exists, so the observer sees an open session
      // rather than fetching over the seed (the repo's query-cache rule).
      seedQuery(qk.coach.session, { player: { handle: 'Sable' }, coach_name: '' })
      const { palette } = await setup([rec('m1')])
      useCoachStore()
      await nextTick()

      const targets = palette.results.value.map((r) => r.target)
      for (const item of ACTION_ITEMS) {
        expect(targets).not.toContain(item.target)
      }
    })
  })
})
