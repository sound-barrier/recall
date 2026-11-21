import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'

import type { FieldFlag, MatchRecord } from '@/api'
import { flushPromises, renderApp } from '@/test-utils'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'

// The dossier's numbers are the ones a left-out reading changes, so the
// notice sits above them and says how many readings are missing from them —
// with the way to the review that puts them back.

function flag(field: string, state: FieldFlag['state'] = 'open'): FieldFlag {
  return { field, value: '1', checks: ['plausible_range'], state, readings: [] }
}

function flagged(key: string, flags: FieldFlag[]): MatchRecord {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map: 'rialto', result: 'victory', date: '2026-05-10',
      eliminations: 74, assists: 9, deaths: 6, damage: 7200, healing: 300,
    },
    field_flags: flags,
  }
}

async function renderWith(records: MatchRecord[]) {
  await renderApp()
  seedQuery(qk.matches, records)
  await flushPromises()
}

const notice = () => screen.queryByRole('status', { name: 'Readings left out of your stats' })

describe('FieldFlagNotice', () => {
  it('says how many fields are left out across the history', async () => {
    await renderWith([
      flagged('match-2026-05-10T22-00-00', [flag('data.damage'), flag('data.eliminations')]),
      flagged('match-2026-05-10T22-30-00', [flag('data.healing'), flag('data.level', 'confirmed')]),
    ])

    expect(notice()).toHaveTextContent('3 fields left out of your stats pending review')
  })

  it('speaks of one field in the singular', async () => {
    await renderWith([flagged('match-2026-05-10T22-00-00', [flag('data.damage')])])

    expect(notice()).toHaveTextContent('1 field left out of your stats pending review')
  })

  // A flag on who was played leaves no number out, so it is review work for
  // the Unknown tab but nothing this notice can honestly claim.
  it('stays away while nothing is left out', async () => {
    await renderWith([flagged('match-2026-05-10T22-00-00', [flag('data.heroes_played'), flag('data.damage', 'edited')])])

    expect(notice()).not.toBeInTheDocument()
  })

  it('takes the player to the Unknown tab to review them', async () => {
    await renderWith([flagged('match-2026-05-10T22-00-00', [flag('data.damage')])])

    await userEvent.click(screen.getByRole('button', { name: 'Review flagged readings' }))
    await flushPromises()

    expect(screen.getByRole('tab', { name: /^Unknown/ })).toHaveAttribute('aria-selected', 'true')
  })

  // In a coaching session the dossier is the player's loaned corpus. The
  // numbers still leave the readings out, but they are not the coach's, and
  // settling them is the player's write — so the notice says whose they are
  // and sends the coach nowhere.
  it("speaks of the player's stats in a coaching session and offers no review", async () => {
    await renderApp()
    seedQuery(qk.coach.session, {
      player: { id: 'sable-id', handle: 'Sable', message: '' },
      exported_at: '2026-08-14T18:30:00Z', session_date: '2026-08-15', match_count: 1,
      coach_name: 'Ordo', summary: '', notes: [], handle_from_bundle: true, source: 'bundle' as const,
    })
    seedQuery(qk.coach.matches, [flagged('match-2026-05-10T22-00-00', [flag('data.damage')])])
    await flushPromises()
    await flushPromises()

    const loaned = screen.getByRole('status', { name: "Readings left out of the player's stats" })
    expect(loaned).toHaveTextContent('1 field left out of these stats until the player reviews it')
    expect(screen.queryByRole('button', { name: 'Review flagged readings' })).not.toBeInTheDocument()
  })
})
