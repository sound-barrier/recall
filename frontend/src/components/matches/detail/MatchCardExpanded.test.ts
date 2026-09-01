import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { render, screen, fireEvent, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'

import MatchCardExpanded from '@/components/matches/detail/MatchCardExpanded.vue'
import type { MatchRecord } from '@/api'

// The write gate reads the profiles query + the coaching-session store;
// these cases pin this component's own contract, so stub it open.
vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))
import { resetWriteGate, setWritesLocked } from '@/test-utils/writeGateStub'

// The nested MatchJournal now writes annotations store-direct through
// useMatchActions (for the saved-pulse persistence receipt). These tests
// pin MatchCardExpanded's own contract, so stub the action layer rather
// than standing up Pinia + the api seam.
vi.mock('@/composables/matches/useMatchActions', () => ({
  useMatchActions: () => ({
    onSetMatchAnnotation: vi.fn().mockResolvedValue(true),
  }),
}))

// MatchCardExpanded owns annotation draft state, the leaver-chooser
// chips, heroes-played collapse, and the sources block. These tests
// pin the externally-observable contract: emits + render branches.

function makeRecord(over: Partial<MatchRecord['data']> = {}, top: Partial<MatchRecord> = {}): MatchRecord {
  return {
    match_key: 'match-2026-05-10T22-21-11',
    source_files: ['a.png'],
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control',
      role: 'support', hero: 'lucio', result: 'victory',
      date: '2026-05-10', finished_at: '22:21',
      eliminations: 17, assists: 12, deaths: 8, damage: 8500,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '10:25' }],
      ...over,
    },
    parsed_at: '2026-05-10T22:30:00Z',
    ...top,
  }
}

function renderCard(over: { record?: MatchRecord; isSourcesOpen?: boolean } = {}) {
  return render(MatchCardExpanded, {
    props: {
      record: over.record ?? makeRecord(),
      isSourcesOpen: over.isSourcesOpen ?? false,
      isPreviewOpen:   () => false,
      hasPreviewError: () => false,
      isActive: () => false,
    },
  })
}

describe('MatchCardExpanded — reference-data gap banner', () => {
  // NoteWriter reads the UI store to freeze the app while it is expanded.
  beforeEach(() => { setActivePinia(createPinia()) })

  it('warns when the OCR hero never pinned to the canonical roster, quoting the raw read', () => {
    const rec = makeRecord({ hero: '', hero_raw: 'Neon Function' })
    renderCard({ record: rec })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Unknown hero detected')
    expect(alert).toHaveTextContent(/known\s+hero/)
    expect(alert).toHaveTextContent('Neon Function')
  })

  it('warns about the MAP instead when that is the field that failed to pin', () => {
    const rec = makeRecord({ map: '', map_raw: 'Neon Junctlon' })
    renderCard({ record: rec })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Unknown map detected')
    expect(alert).toHaveTextContent(/known\s+map/)
    expect(alert).toHaveTextContent('Neon Junctlon')
  })

  it('stays silent on a record that pinned both', () => {
    renderCard()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('MatchCardExpanded — meta strip', () => {
  it('leads with when / final score / parsed for a fully-scanned match', () => {
    renderCard({ record: makeRecord({ final_score: '2 - 1' }) })
    expect(screen.getByText('When')).toBeInTheDocument()
    expect(screen.getByText('Final Score')).toBeInTheDocument()
    expect(screen.getByText('2 - 1')).toBeInTheDocument()
    expect(screen.getByText('Parsed')).toBeInTheDocument()
  })

  it('drops the cells the scan never produced rather than rendering blanks', () => {
    // A manual leaver-exit row has no scoreboard time and no final score.
    const bare = makeRecord({ date: undefined, finished_at: undefined, final_score: undefined })
    renderCard({ record: bare })
    expect(screen.queryByText('Final Score')).not.toBeInTheDocument()
    expect(screen.queryByText('When')).not.toBeInTheDocument()
    // Parsed survives — it is set by the pipeline, not the OCR.
    expect(screen.getByText('Parsed')).toBeInTheDocument()
  })
})

describe('MatchCardExpanded — play-mode auto-detect on open', () => {
  // Pre-fix, a match with data.playlist='competitive' and no override read
  // "Competitive" on the leaf, "Not set" in the chooser, and dropped out of
  // the Play-mode narrow — three surfaces, three answers.
  it('adopts the OCR playlist when the match carries no override yet', () => {
    const { emitted } = renderCard({ record: makeRecord({ playlist: 'competitive' }) })
    expect(emitted('set-match-play-mode')[0]).toEqual(['match-2026-05-10T22-21-11', 'competitive'])
  })

  it('adopts quickplay the same way', () => {
    const { emitted } = renderCard({ record: makeRecord({ playlist: 'quickplay' }) })
    expect(emitted('set-match-play-mode')[0]).toEqual(['match-2026-05-10T22-21-11', 'quickplay'])
  })

  it('leaves an explicit user override alone', () => {
    const rec = makeRecord({ playlist: 'competitive' }, { play_mode: 'quickplay' } as unknown as Partial<MatchRecord>)
    const { emitted } = renderCard({ record: rec })
    expect(emitted('set-match-play-mode')).toBeFalsy()
  })

  it('stays silent while writes are locked — a loaned match has no row here to sync', () => {
    setWritesLocked(true, { session: true })
    const { emitted } = renderCard({ record: makeRecord({ playlist: 'competitive' }) })
    expect(emitted('set-match-play-mode')).toBeFalsy()
    resetWriteGate()
  })

  it('ignores a playlist value that is not one of the two real modes', () => {
    const { emitted } = renderCard({ record: makeRecord({ playlist: 'unranked' }) })
    expect(emitted('set-match-play-mode')).toBeFalsy()
  })
})

describe('MatchCardExpanded — inline stat editing', () => {
  const editTrigger = (label: string) =>
    screen.getByRole('button', { name: new RegExp(`^${label}:`) })

  it('commits an edited stat as a FULL override set, preserving the existing ones', async () => {
    // UpdateMatchData replaces the set wholesale, so an edit that forgets the
    // other overrides silently reverts them to OCR.
    const rec = makeRecord({ deaths: 8 }, { edited_fields: ['data.deaths'] } as unknown as Partial<MatchRecord>)
    const { emitted } = renderCard({ record: rec })

    await userEvent.setup().click(editTrigger('Elims'))
    const input = screen.getByRole('spinbutton', { name: 'Edit Elims' })
    await fireEvent.update(input, '21')
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(emitted('update-match-data')[0]).toEqual([rec.match_key, { deaths: 8, eliminations: 21 }])
  })

  it('reverting the LAST override resets the match to OCR instead of persisting an empty set', async () => {
    // An empty override row would still read as "edited" everywhere.
    const rec = makeRecord({ damage: 9999 }, { edited_fields: ['data.damage'] } as unknown as Partial<MatchRecord>)
    const { emitted } = renderCard({ record: rec })

    await userEvent.setup().click(screen.getByRole('button', { name: 'Revert Damage to the scanned value' }))
    expect(emitted('reset-match-data')[0]).toEqual([rec.match_key])
    expect(emitted('update-match-data')).toBeFalsy()
  })

  it('reverting one of several overrides keeps the rest', async () => {
    const rec = makeRecord(
      { damage: 9999, deaths: 8 },
      { edited_fields: ['data.damage', 'data.deaths'] } as unknown as Partial<MatchRecord>,
    )
    const { emitted } = renderCard({ record: rec })

    await userEvent.setup().click(screen.getByRole('button', { name: 'Revert Damage to the scanned value' }))
    expect(emitted('update-match-data')[0]).toEqual([rec.match_key, { deaths: 8 }])
    expect(emitted('reset-match-data')).toBeFalsy()
  })

  it('offers a revert affordance only on the fields the user actually edited', () => {
    const rec = makeRecord({ damage: 9999 }, { edited_fields: ['data.damage'] } as unknown as Partial<MatchRecord>)
    renderCard({ record: rec })
    expect(screen.getByRole('button', { name: 'Revert Damage to the scanned value' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revert Elims to the scanned value' })).not.toBeInTheDocument()
  })

  it('formats the volume stats with thousands separators', () => {
    renderCard({ record: makeRecord({ damage: 8500, healing: 12000 }) })
    expect(editTrigger('Damage')).toHaveAccessibleName('Damage: 8,500. Click to edit.')
    expect(editTrigger('Healing')).toHaveAccessibleName('Healing: 12,000. Click to edit.')
  })

  it('wires every stat cell to its OWN field — and strips the display format', async () => {
    // Six near-identical bindings: a copy-paste slip sends one stat's edit
    // to a neighbor's column, and the grid still looks right. The formatted
    // stats matter twice over — committing "12,000" would reach the server
    // as a string.
    const cases: [string, string, number][] = [
      ['Elims', 'eliminations', 21],
      ['Assists', 'assists', 14],
      ['Deaths', 'deaths', 4],
      ['Damage', 'damage', 12000],
      ['Healing', 'healing', 9800],
      ['Mitigation', 'mitigation', 3300],
    ]
    for (const [label, field, value] of cases) {
      const { emitted, unmount } = renderCard()
      await userEvent.setup().click(editTrigger(label))
      const input = screen.getByRole('spinbutton', { name: `Edit ${label}` })
      await fireEvent.update(input, String(value))
      await fireEvent.keyDown(input, { key: 'Enter' })

      expect(emitted('update-match-data')[0]).toEqual([
        'match-2026-05-10T22-21-11', { [field]: value },
      ])
      unmount()
    }
  })

  it('wires every revert to its OWN override path', async () => {
    // Same copy-paste risk on the revert side: reverting Healing must not
    // drop Deaths from the set the parent re-sends.
    const fields = ['eliminations', 'assists', 'deaths', 'damage', 'healing', 'mitigation']
    const labels = ['Elims', 'Assists', 'Deaths', 'Damage', 'Healing', 'Mitigation']
    for (const [i, field] of fields.entries()) {
      const rec = makeRecord(
        { eliminations: 1, assists: 2, deaths: 3, damage: 4, healing: 5, mitigation: 6 },
        { edited_fields: fields.map(f => `data.${f}`) } as unknown as Partial<MatchRecord>,
      )
      const { emitted, unmount } = renderCard({ record: rec })
      await userEvent.setup().click(
        screen.getByRole('button', { name: `Revert ${labels[i]} to the scanned value` }),
      )
      const sent = emitted('update-match-data')[0] as [string, Record<string, number>]
      expect(Object.keys(sent[1]).sort()).toEqual(fields.filter(f => f !== field).sort())
      unmount()
    }
  })

  it('renders an em dash for a stat the scan never produced', () => {
    renderCard({ record: makeRecord({ mitigation: undefined }) })
    expect(editTrigger('Mitigation')).toHaveAccessibleName('Mitigation: —. Click to edit.')
  })
})

describe('MatchCardExpanded — stats grid', () => {
  it('renders six stat cells in the match-stats grid', () => {
    renderCard()
    // Eliminations, Assists, Deaths, Damage, Healing, Mitigation —
    // each an EditableStat whose trigger is labeled "<Stat>: <value>.
    // Click to edit."
    expect(screen.getAllByRole('button', { name: /Click to edit/ }).length).toBeGreaterThanOrEqual(6)
  })

  it('shows the eliminations + assists numeric values', () => {
    renderCard()
    expect(screen.getByText('17')).toBeInTheDocument() // eliminations
    expect(screen.getByText('12')).toBeInTheDocument() // assists
    // Damage is formatted with thousands separator on render
    // (`8,500`), so assert the leading digit.
    expect(screen.getByText(/8[,.]?5/)).toBeInTheDocument()
  })
})

describe('MatchCardExpanded — disruption chips', () => {
  // Two choosers are mounted (leavers, then throwers), each with three side
  // chips. They are independent multi-select toggles, so the payload is the
  // full side SET the chooser wants — picking a second side ADDS to it rather
  // than replacing the first, which is what the old single-value column
  // couldn't express.
  const user = () => userEvent.setup()

  it('emits the leavers set when a side chip is clicked from an untagged record', async () => {
    const { emitted } = renderCard()
    expect(screen.getByRole('button', { name: /Ally left/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Enemy left/ })).toBeInTheDocument()
    await user().click(screen.getByRole('button', { name: /I left/ }))
    const e = emitted('set-disruption')
    expect(e[0]).toEqual(['match-2026-05-10T22-21-11', 'leavers', ['self']])
  })

  it('adds a second side rather than replacing the first', async () => {
    const rec = makeRecord({}, { annotation: { leavers: ['team'], throwers: [] } } as unknown as Partial<MatchRecord>)
    const { emitted } = renderCard({ record: rec })
    await user().click(screen.getByRole('button', { name: /I left/ }))
    expect(emitted('set-disruption')[0]).toEqual([rec.match_key, 'leavers', ['team', 'self']])
  })

  it('removes a side when its already-active chip is re-clicked', async () => {
    const rec = makeRecord({}, { annotation: { leavers: ['self', 'team'], throwers: [] } } as unknown as Partial<MatchRecord>)
    const { emitted } = renderCard({ record: rec })
    await user().click(screen.getByRole('button', { name: /I left/ }))
    expect(emitted('set-disruption')[0]).toEqual([rec.match_key, 'leavers', ['team']])
  })

  it('keeps the thrower chooser independent of the leaver one', async () => {
    const rec = makeRecord({}, { annotation: { leavers: ['team'], throwers: [] } } as unknown as Partial<MatchRecord>)
    const { emitted } = renderCard({ record: rec })
    await user().click(screen.getByRole('button', { name: /Enemy threw/ }))
    expect(emitted('set-disruption')[0]).toEqual([rec.match_key, 'throwers', ['enemy']])
  })

  it('marks only the active side chips with aria-pressed="true"', () => {
    const rec = makeRecord({}, { annotation: { leavers: ['team'], throwers: ['enemy'] } } as unknown as Partial<MatchRecord>)
    renderCard({ record: rec })
    expect(screen.getByRole('button', { name: /I left/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /Ally left/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Enemy left/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /Enemy threw/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Ally threw/ })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('MatchCardExpanded — heroes played toggle', () => {
  it('renders the heroes-played list initially expanded', () => {
    renderCard()
    // heroesExpanded starts true; the hero entry should be present.
    expect(screen.getAllByText(/lucio/).length).toBeGreaterThan(0)
  })
})

describe('MatchCardExpanded — sources block', () => {
  it('renders the sources block only when isSourcesOpen is true', () => {
    renderCard({ isSourcesOpen: false })
    // The source-file list is only mounted when isSourcesOpen=true.
    expect(screen.queryByText(/a\.png/)).not.toBeInTheDocument()
  })

  it('shows the source filename in the open sources block', () => {
    renderCard({ isSourcesOpen: true })
    expect(screen.getByText(/a\.png/)).toBeInTheDocument()
  })
})

describe('MatchCardExpanded — status choosers', () => {
  const chooser = (name: string) => within(screen.getByRole('radiogroup', { name }))

  it('lifts a queue-type pick with the match key', async () => {
    const { emitted } = renderCard()
    await userEvent.setup().click(chooser('Match queue type').getByRole('radio', { name: /Open Queue/ }))
    expect(emitted('set-match-queue')[0]).toEqual(['match-2026-05-10T22-21-11', 'open'])
  })

  it('lifts a play-mode pick', async () => {
    const rec = makeRecord({}, { play_mode: 'quickplay' } as unknown as Partial<MatchRecord>)
    const { emitted } = renderCard({ record: rec })
    await userEvent.setup().click(chooser('Match play mode').getByRole('radio', { name: /Competitive/ }))
    expect(emitted('set-match-play-mode')?.at(-1)).toEqual([rec.match_key, 'competitive'])
  })

  it('lifts a review-status pick', async () => {
    const { emitted } = renderCard()
    await userEvent.setup().click(chooser('Match review status').getByRole('radio', { name: /Coach/ }))
    expect(emitted('set-match-review')[0]).toEqual(['match-2026-05-10T22-21-11', 'coach'])
  })

  it('clearing an active pick lifts the empty string the DELETE path keys on', async () => {
    const rec = makeRecord({}, { queue_type: 'role' } as unknown as Partial<MatchRecord>)
    const { emitted } = renderCard({ record: rec })
    await userEvent.setup().click(chooser('Match queue type').getByRole('radio', { name: /Not set/ }))
    expect(emitted('set-match-queue')[0]).toEqual([rec.match_key, ''])
  })

  it('re-picking the active chip toggles it back off', async () => {
    const rec = makeRecord({}, { queue_type: 'role' } as unknown as Partial<MatchRecord>)
    const { emitted } = renderCard({ record: rec })
    await userEvent.setup().click(chooser('Match queue type').getByRole('radio', { name: /Role Queue/ }))
    expect(emitted('set-match-queue')[0]).toEqual([rec.match_key, ''])
  })

  it('clicking Not set on an already-unset match lifts nothing', async () => {
    // No-op guard: a redundant DELETE would still trigger a records reload.
    const { emitted } = renderCard()
    await userEvent.setup().click(chooser('Match queue type').getByRole('radio', { name: /Not set/ }))
    expect(emitted('set-match-queue')).toBeFalsy()
  })
})

describe('MatchCardExpanded — filter hand-offs', () => {
  it('lifts a hero chip click as a hero filter', async () => {
    const { emitted } = renderCard()
    await userEvent.setup().click(screen.getByRole('button', { name: /^Filter by hero:/ }))
    expect(emitted('filter-toggle')[0]).toEqual(['hero', 'lucio'])
  })

  it('lifts a source-type chip click as a screenshot filter', async () => {
    const { emitted } = renderCard({ isSourcesOpen: true })
    await userEvent.setup().click(screen.getByRole('button', { name: /^Filter by source type:/ }))
    expect(emitted('filter-toggle')[0]).toEqual(['sshot', expect.any(String)])
  })

  it('lifts the per-file preview toggle', async () => {
    const { emitted } = renderCard({ isSourcesOpen: true })
    await userEvent.setup().click(screen.getByRole('link', { name: /a\.png/ }))
    expect(emitted('toggle-preview')[0]).toEqual(['a.png'])
  })

  it('lifts a click on the inline preview as a full-screen request, with the whole file list', async () => {
    // The lightbox needs the owning match's files + dir ids to offer
    // prev/next; handing it only the clicked filename strands navigation.
    const rec = makeRecord({}, { source_files: ['a.png', 'b.png'], source_dir_ids: { 'a.png': 0, 'b.png': 0 } } as unknown as Partial<MatchRecord>)
    const { emitted } = render(MatchCardExpanded, {
      props: {
        record: rec,
        isSourcesOpen: true,
        isPreviewOpen: () => true,
        hasPreviewError: () => false,
        isActive: () => false,
      },
    })
    await userEvent.setup().click(screen.getAllByRole('img', { name: 'a.png' })[0]!)
    expect(emitted('open-lightbox')[0]).toEqual(['a.png', ['a.png', 'b.png'], { 'a.png': 0, 'b.png': 0 }])
  })

  it('lifts a broken preview image so the parent can mark it errored', async () => {
    const { emitted } = render(MatchCardExpanded, {
      props: {
        record: makeRecord(),
        isSourcesOpen: true,
        isPreviewOpen: () => true,
        hasPreviewError: () => false,
        isActive: () => false,
      },
    })
    await fireEvent.error(screen.getAllByRole('img', { name: 'a.png' })[0]!)
    expect(emitted('preview-error')[0]).toEqual(['a.png'])
  })
})

describe('MatchCardExpanded — journal hand-off', () => {
  it('forwards the journal focus-consumed signal so the parent clears its one-shot', async () => {
    const { emitted } = render(MatchCardExpanded, {
      props: {
        record: makeRecord(),
        isSourcesOpen: false,
        isPreviewOpen: () => false,
        hasPreviewError: () => false,
        isActive: () => false,
        pendingFocus: 'tag' as const,
      },
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(emitted('focus-consumed')).toHaveLength(1)
  })
})

describe('MatchCardExpanded — since-this-match anchor toggle', () => {
  function renderAnchor(anchorKey?: string) {
    return render(MatchCardExpanded, {
      props: {
        record: makeRecord(),
        isSourcesOpen: false,
        isPreviewOpen:   () => false,
        hasPreviewError: () => false,
        isActive: () => false,
        anchorKey,
      },
    })
  }

  it('renders the anchor button with the idle copy when this match is NOT the anchor', () => {
    renderAnchor('some-other-match')
    // Action-first label ("Filter from this match") + plain-language
    // sublabel that names the consequence inline so a touch /
    // keyboard user doesn't depend on the tooltip.
    const btn = screen.getByRole('button', { name: /Filter from this match/i })
    expect(btn).toHaveTextContent(/marks this as your reference point/i)
    expect(btn).toHaveAttribute('aria-pressed', 'false')
  })

  it('renders the anchor button pressed with the active copy when this match IS the anchor', () => {
    renderAnchor('match-2026-05-10T22-21-11')
    const btn = screen.getByRole('button', { name: /Filtering from this match/i })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(btn).toHaveTextContent(/Reference set/i)
    expect(btn).toHaveTextContent(/click to clear/i)
  })

  it('clicking when not the anchor emits set-anchor(matchKey)', async () => {
    const user = userEvent.setup()
    const { emitted } = renderAnchor('')
    await user.click(screen.getByRole('button', { name: /Filter from this match/i }))
    expect(emitted('set-anchor')).toBeTruthy()
    expect(emitted('set-anchor')[0]).toEqual(['match-2026-05-10T22-21-11'])
  })

  it('clicking when this match IS the anchor emits set-anchor("") to clear', async () => {
    const user = userEvent.setup()
    const { emitted } = renderAnchor('match-2026-05-10T22-21-11')
    await user.click(screen.getByRole('button', { name: /Filtering from this match/i }))
    expect(emitted('set-anchor')[0]).toEqual([''])
  })
})

// A hidden record can't surface in the detail panel (the panel's selection
// runs over the narrowed set, which excludes hidden), so the Unhide affordance
// is covered here at the card level where a hidden record mounts directly.
describe('MatchCardExpanded — soft-delete (hidden record)', () => {
  it('shows Unhide (not Hide) on a hidden record', () => {
    const hidden = makeRecord({}, { hidden: true } as unknown as Partial<MatchRecord>)
    renderCard({ record: hidden })
    expect(screen.getByRole('button', { name: /Unhide/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Hide match/ })).not.toBeInTheDocument()
  })

  it('Unhide click emits set-match-hidden(match_key, false) — no confirm step', async () => {
    const user = userEvent.setup()
    const hidden = makeRecord({}, { hidden: true } as unknown as Partial<MatchRecord>)
    const { emitted } = renderCard({ record: hidden })
    await user.click(screen.getByRole('button', { name: /Unhide/ }))
    expect(emitted('set-match-hidden')[0]).toEqual([hidden.match_key, false])
  })
})

// Design rule 7: a loaned match's "When" is the PLAYER's naive clock. The
// instant below lands on a different calendar day than the naive pair in
// every host zone, so a panel that rendered it would contradict both the
// row it was opened from and the day the match is grouped under.
describe("MatchCardExpanded — the player's clock", () => {
  const LOANED = { date: '1999-01-01', finished_at: '21:14', played_at_utc: '2026-05-11T03:29:00Z' }

  it("reads the player's naive day and time while a coaching session is open", () => {
    setWritesLocked(true, { session: true })
    renderCard({ record: makeRecord(LOANED) })
    expect(screen.getByText('January 1, 1999 @ 9:14pm')).toBeInTheDocument()
  })

  it("reads the viewer's clock outside a session", () => {
    resetWriteGate()
    renderCard({ record: makeRecord(LOANED) })
    expect(screen.queryByText('January 1, 1999 @ 9:14pm')).toBeNull()
  })
})
