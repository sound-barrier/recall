import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import type { FormCondition, TimeWindow } from '@/match/compare/match-form-slices'
import { useFormDrill } from '@/composables/compare/useFormDrill'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'

// The drill-through from a Compare cell into the Matches tab. Every assertion
// reads the shared narrow bundle afterwards — that bundle IS the contract the
// Matches view renders from, so a wrong write here silently shows the user a
// list that contradicts the cell they clicked.

const WINDOW: TimeWindow = { from: '2026-05-01', to: '2026-05-07' }
const ANY: FormCondition = { kind: 'any' }

function harness() {
  setActivePinia(createPinia())
  const matchesStore = useMatchesStore()
  const appStore = useAppStore()
  return { narrow: matchesStore.matchesNarrow, appStore, drill: useFormDrill().drill }
}

describe('useFormDrill', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('writes the cell window as a custom range with no time bounds and lands on Matches', () => {
    const { narrow, appStore, drill } = harness()
    // A stale minute-level bound from an earlier narrow must not survive — it
    // would tighten the drilled list below the window the cell counted.
    narrow.customFromTime.value = '18:00'
    narrow.customToTime.value = '23:00'

    drill('games', WINDOW, ANY)

    expect(narrow.pickedRange.value).toBe('custom')
    expect(narrow.customFrom.value).toBe('2026-05-01')
    expect(narrow.customTo.value).toBe('2026-05-07')
    expect(narrow.customFromTime.value).toBe('')
    expect(narrow.customToTime.value).toBe('')
    expect(appStore.view).toBe('matches')
  })

  it('preserves the leaver handling the cell was computed under across the reset', () => {
    const { narrow, drill } = harness()
    narrow.leaverHandling.value = 'exclude-tally'
    drill('games', WINDOW, ANY)
    // resetNarrow() forces 'include'; re-admitting leaver matches would make
    // the drilled list larger than the cell's count.
    expect(narrow.leaverHandling.value).toBe('exclude-tally')
  })

  it('clears every unrelated pick the previous narrow carried', () => {
    const { narrow, drill } = harness()
    narrow.pickMap('rialto')
    narrow.pickHero('genji')
    drill('games', WINDOW, ANY)
    expect(narrow.pickedMaps.value.size).toBe(0)
    expect(narrow.pickedHeroes.value.size).toBe(0)
  })

  it('translates a row key into the narrow pick that names the same dimension', () => {
    const check = (rowKey: string, read: (n: ReturnType<typeof harness>['narrow']) => unknown, want: unknown) => {
      const { narrow, drill } = harness()
      drill(rowKey, WINDOW, ANY)
      expect(read(narrow)).toEqual(want)
    }
    check('roleTank', (n) => [...n.pickedRoles.value], ['tank'])
    check('roleDps', (n) => [...n.pickedRoles.value], ['dps'])
    check('roleSupport', (n) => [...n.pickedRoles.value], ['support'])
    check('compGames', (n) => [...n.pickedPlayModes.value], ['competitive'])
    check('qpGames', (n) => [...n.pickedPlayModes.value], ['quickplay'])
    check('roleQueue', (n) => [...n.pickedQueues.value], ['role'])
    check('openQueue', (n) => [...n.pickedQueues.value], ['open'])
  })

  it('reads a mode: row key as the game-mode suffix it carries', () => {
    const { narrow, drill } = harness()
    drill('mode:flashpoint', WINDOW, ANY)
    expect([...narrow.pickedGameModes.value]).toEqual(['flashpoint'])
  })

  it('drills a dimensionless row to the bare window with no picks at all', () => {
    const { narrow, drill } = harness()
    drill('winrate', WINDOW, ANY)
    expect(narrow.pickedRoles.value.size).toBe(0)
    expect(narrow.pickedGameModes.value.size).toBe(0)
    expect(narrow.activeClauseCount.value).toBe(1) // the date range only
  })

  it('applies a member or hero column condition on top of the row dimension', () => {
    const member = harness()
    member.drill('roleDps', WINDOW, { kind: 'member', name: 'Ratbag' })
    expect([...member.narrow.pickedRoles.value]).toEqual(['dps'])
    expect([...member.narrow.pickedMembers.value]).toEqual(['Ratbag'])

    const hero = harness()
    hero.drill('games', WINDOW, { kind: 'hero', hero: 'genji' })
    expect([...hero.narrow.pickedHeroes.value]).toEqual(['genji'])
  })

  it('does not re-pick a role condition that duplicates the row — the toggle would cancel it', () => {
    const same = harness()
    same.drill('roleTank', WINDOW, { kind: 'role', role: 'tank' })
    // Picking 'tank' twice would toggle the clause straight back off and drill
    // to an unfiltered window.
    expect([...same.narrow.pickedRoles.value]).toEqual(['tank'])

    // A role condition on a NON-role row still applies.
    const other = harness()
    other.drill('games', WINDOW, { kind: 'role', role: 'support' })
    expect([...other.narrow.pickedRoles.value]).toEqual(['support'])
  })
})
