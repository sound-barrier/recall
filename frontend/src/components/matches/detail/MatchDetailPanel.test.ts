import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { createPinia, setActivePinia } from 'pinia'

import { flushPromises } from '@/test-utils'
import MatchDetailPanel from '@/components/matches/detail/MatchDetailPanel.vue'
import { useUiStore } from '@/stores/ui'
import { useMatchesStore } from '@/stores/matches'
import { SetMatchAnnotation, DeleteMatchAnnotation, SetMatchVisibility, ResetMatchData } from '@/api'
import type { MatchRecord } from '@/api'
import { leaveWriter, markdownField } from '@/test-utils'

// Unit tests for MatchDetailPanel's rendered body — the same surfaces that used
// to live inline inside MatchCard (annotation journal, leaver chooser, stats
// grid, heroes-played, sources, rank, danger row), hosted inside the right-edge
// slide-in panel. The panel now reads all of its state from the Pinia stores
// (selection / preview / narrow) and drives its mutations through
// useMatchActions, so these tests seed the stores and assert on the api calls /
// store state the panel triggers, rather than on emitted events.
//
// The panel + the matches store statically import '@/api'. Keep the module real
// except the mutation calls the panel drives (so we can assert on them) and
// GetMatchResults — the store's reload-after-mutation returns the seeded
// records rather than hitting the real transport + auto-closing the panel.
// e2e tests in frontend/tests/e2e/match-detail-panel*.spec.ts cover the full
// open/close/paginate transport chain in a real browser.
const h = vi.hoisted(() => ({ records: [] as unknown[] }))
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  GetMatchResults:       vi.fn(async () => h.records),
  SetMatchAnnotation:    vi.fn(async () => undefined),
  DeleteMatchAnnotation: vi.fn(async () => undefined),
  SetMatchVisibility:    vi.fn(async () => undefined),
  ResetMatchData:        vi.fn(async () => undefined),
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

function makeRecord(over: Partial<MatchRecord['data']> = {}, recOver: Partial<MatchRecord> = {}): MatchRecord {
  return {
    match_key: 'match-2026-05-10T21-29-28',
    source_files: ['summary.png', 'scoreboard.png'],
    source_types: { 'summary.png': 'summary', 'scoreboard.png': 'teams' },
    data: {
      map: 'rialto',
      playlist: 'competitive',
      game_mode: 'control',
      role: 'support',
      hero: 'lucio',
      result: 'victory',
      date: '2026-05-10',
      finished_at: '21:29',
      game_length: '11:25',
      final_score: '3-1',
      eliminations: 17,
      assists: 16,
      deaths: 11,
      damage: 7200,
      healing: 4800,
      mitigation: 0,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25', stats: { weapon_accuracy: 24 } }],
      ...over,
    },
    ...recOver,
  }
}

interface PanelRenderOver {
  record?:        MatchRecord
  records?:       MatchRecord[]
  selectKey?:     string
  isSourcesOpen?: boolean
  previewOpen?:   Record<string, boolean>
  previewError?:  Record<string, boolean>
}

// Flips the per-match preview UI flags the panel forwards to MatchCardExpanded.
function seedPreviewFlags(ui: ReturnType<typeof useUiStore>, over: PanelRenderOver) {
  for (const [f, on] of Object.entries(over.previewOpen ?? {})) if (on) ui.preview.togglePreview(f)
  for (const [f, on] of Object.entries(over.previewError ?? {})) if (on) ui.preview.onPreviewError(f)
}

// Seeds the matches store with the record(s), opens the selection (the panel
// reads selectedRecord from the narrowed set), and flips the per-match
// preview/sources UI state the panel forwards to MatchCardExpanded.
function renderPanel(over: PanelRenderOver = {}) {
  setActivePinia(createPinia())
  const record = over.record ?? makeRecord()
  const records = over.records ?? [record]
  h.records = records
  const matches = useMatchesStore()
  matches.records = records
  const ui = useUiStore()
  const key = over.selectKey ?? record.match_key
  ui.selection.open(key)
  if (over.isSourcesOpen) ui.toggleSources(key)
  seedPreviewFlags(ui, over)
  const view = render(MatchDetailPanel)
  return { view, ui, matches, record, key }
}

const user = () => userEvent.setup()

// The 2nd argument of the most recent SetMatchAnnotation call — the merged
// annotation row the panel's useMatchActions handler PUTs.
const lastAnnotation = () => (SetMatchAnnotation as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1]

// Member chips carry a labeled remove button; the label embeds the
// BattleTag, so the roster reads straight off the accessible names.
const memberChips = () => screen.queryAllByLabelText(/^Remove .+ from group$/)
  .map((b) => (b.getAttribute('aria-label') ?? '').replace(/^Remove /, '').replace(/ from group$/, ''))

const dangerGroup = () => within(screen.getByRole('group', { name: 'Match visibility' }))

describe('MatchDetailPanel — match stats + heroes + rank', () => {
  it('renders six stat cells in the Match Stats grid', () => {
    renderPanel()
    // Each stat is an EditableStat whose trigger is labeled
    // "<Stat>: <value>. Click to edit."
    const stats = screen.getAllByRole('button', { name: /Click to edit/ })
    expect(stats).toHaveLength(6)
    expect(screen.getByRole('button', { name: /Damage: 7,200/ })).toBeInTheDocument()
  })

  it('renders the Final Score meta when present', () => {
    renderPanel()
    expect(screen.getByText('Final Score')).toBeInTheDocument()
    expect(screen.getByText('3-1')).toBeInTheDocument()
  })

  it('renders heroes_played list with percent + play time + stats', () => {
    renderPanel()
    // Each hero's cells sit in a group named for that hero — which is what
    // disambiguates the play time from the identical game-length meta.
    const lucio = within(screen.getByRole('group', { name: 'lucio' }))
    expect(lucio.getByText('100%')).toBeInTheDocument()
    expect(lucio.getByText('11:25')).toBeInTheDocument()
    expect(screen.getByText(/weapon accuracy/)).toBeInTheDocument()
    expect(screen.getByText(/24/)).toBeInTheDocument()
  })

  it('renders the rank block with tier + progress + SR deltas', () => {
    const rec = makeRecord({
      rank: 'platinum', level: 3, rank_progress: 40, change_percent: 5,
      modifiers: ['expected', 'victory'],
      sr: [
        { hero: 'lucio', sr: 3200, change: 30 },
        { hero: 'kiriko', sr: 3100, change: -10 },
      ],
    } as unknown as Partial<MatchRecord['data']>)
    const { view } = renderPanel({ record: rec })
    expect(screen.getByText(/platinum 3/)).toBeInTheDocument()
    expect(screen.getByText('40% progress')).toBeInTheDocument()
    expect(screen.getByText('+5%')).toBeInTheDocument()
    // Modifier chips are an unlabeled run inside a heterogeneous flex row
    // (tier / progress / change / modifiers); their ORDER has no accessible
    // expression short of restructuring that row into a list.
    // eslint-disable-next-line testing-library/no-node-access -- pins modifier ORDER, which no accessible query expresses
    const modifiers = [...view.baseElement.querySelectorAll('.rank-modifier')].map((m) => m.textContent?.trim())
    expect(modifiers).toEqual(['expected', 'victory'])
    // The SR entries ARE a list, so both the per-line grouping of
    // hero/SR/delta and their order read straight off the a11y tree.
    const srLines = within(screen.getByRole('list', { name: 'SR changes' })).getAllByRole('listitem')
    expect(srLines).toHaveLength(2)
    expect(srLines[0]).toHaveTextContent('lucio')
    expect(srLines[0]).toHaveTextContent('3200')
    expect(srLines[0]).toHaveTextContent('+30')
    expect(srLines[1]).toHaveTextContent('-10')
  })
})

describe('MatchDetailPanel — sources panel', () => {
  it('renders the sources toggle with file count', () => {
    renderPanel()
    expect(screen.getByText('Source Screenshots')).toBeInTheDocument()
    // The count badge names itself — a bare "2" says nothing on its own.
    expect(screen.getByRole('img', { name: '2 source screenshots' })).toBeInTheDocument()
  })

  it('clicking the sources toggle flips the shared sources-open state', async () => {
    const { ui, key } = renderPanel()
    expect(ui.isSourcesOpen(key)).toBe(false)
    await user().click(screen.getByText('Source Screenshots'))
    expect(ui.isSourcesOpen(key)).toBe(true)
  })

  it('renders the source-file list only when sources are open', () => {
    renderPanel()
    expect(screen.queryByText('summary.png')).not.toBeInTheDocument()
  })

  it('renders the source-file list when sources are open', () => {
    renderPanel({ isSourcesOpen: true })
    expect(screen.getByText('summary.png')).toBeInTheDocument()
  })

  it('source-type chips render from source_types map', () => {
    renderPanel({ isSourcesOpen: true })
    const chips = screen.getAllByLabelText(/^Filter by source type:/).map((c) => c.textContent?.trim())
    // "teams" labels as "TEAMS" everywhere in the UI.
    expect(chips).toEqual(['SUMMARY', 'TEAMS'])
  })

  it('clicking a source filename opens that file in the preview state', async () => {
    const { ui } = renderPanel({ isSourcesOpen: true })
    expect(ui.preview.isPreviewOpen('summary.png')).toBe(false)
    await user().click(screen.getByText('summary.png'))
    expect(ui.preview.isPreviewOpen('summary.png')).toBe(true)
  })

  // The preview thumbnail's alt text is the filename it previews, so the
  // img role query names it.
  const previewImg = () => screen.queryByRole('img', { name: 'summary.png' })

  it('renders <img> when previewOpen[file]=true and no error', () => {
    renderPanel({
      isSourcesOpen: true,
      previewOpen: { 'summary.png': true },
    })
    // URL shape: /_screenshot/<dir-id>/<filename>. Test record has
    // no source_dir_ids so dir-id is 0 (configured-folder fallback).
    expect(previewImg()).toHaveAttribute('src', expect.stringContaining('/_screenshot/0/summary.png'))
  })

  it('renders preview error message when previewError[file]=true', () => {
    renderPanel({
      isSourcesOpen: true,
      previewOpen: { 'summary.png': true },
      previewError: { 'summary.png': true },
    })
    expect(previewImg()).not.toBeInTheDocument()
    expect(screen.getByText(/Could not load image/)).toBeInTheDocument()
  })

  it('img @error records a preview error in the shared state', async () => {
    const { ui } = renderPanel({
      isSourcesOpen: true,
      previewOpen: { 'summary.png': true },
    })
    await fireEvent.error(previewImg()!)
    expect(ui.preview.hasPreviewError('summary.png')).toBe(true)
  })

  it('shows the "missing required" explainer when sources open and slots are absent', () => {
    // Drop the scoreboard source so the SCOREBOARD slot is reported
    // missing; SUMMARY stays present.
    const rec = makeRecord({}, {
      source_files: ['summary.png'],
      source_types: { 'summary.png': 'summary' },
    } as unknown as Partial<MatchRecord>)
    renderPanel({ record: rec, isSourcesOpen: true })
    expect(screen.getByText(/TEAMS missing/)).toBeInTheDocument()
  })
})

describe('MatchDetailPanel — parsed timestamps', () => {
  it('renders the match-level "Parsed" meta row when parsed_at is set', () => {
    const rec = makeRecord({}, { parsed_at: '2026-05-10T21:30:00Z' })
    renderPanel({ record: rec })
    expect(screen.getByText('Parsed')).toBeInTheDocument()
    expect(screen.getByTitle('2026-05-10T21:30:00Z')).toBeInTheDocument()
  })

  it('does NOT render the Parsed row when parsed_at is missing (pre-migration rows)', () => {
    const rec = makeRecord({}, { parsed_at: undefined })
    renderPanel({ record: rec })
    expect(screen.queryByText('Parsed')).not.toBeInTheDocument()
  })

  it('renders a per-source-file parsed chip in the Sources panel', () => {
    const rec = makeRecord({}, {
      source_parsed_at: {
        'summary.png': '2026-05-10T21:30:00Z',
        'scoreboard.png': '2026-05-10T21:30:05Z',
      },
    })
    renderPanel({ record: rec, isSourcesOpen: true })
    const chips = screen.getAllByTitle(/^Inserted into the database at/)
    expect(chips).toHaveLength(2)
    expect(chips[0]).toHaveAttribute('title', expect.stringContaining('2026-05-10T21:30:00Z'))
  })

  it('omits the per-source chip for files missing from source_parsed_at', () => {
    const rec = makeRecord({}, {
      source_parsed_at: { 'summary.png': '2026-05-10T21:30:00Z' },
    })
    renderPanel({ record: rec, isSourcesOpen: true })
    expect(screen.getAllByTitle(/^Inserted into the database at/)).toHaveLength(1)
  })

  it('the per-source chip is NOT a filter trigger (inert span, unlike the source-type chip)', () => {
    const rec = makeRecord({}, {
      source_parsed_at: { 'summary.png': '2026-05-10T21:30:00Z' },
    })
    renderPanel({ record: rec, isSourcesOpen: true })
    const chip = screen.getByTitle(/^Inserted into the database at/)
    // A plain span with no role and no tabstop: nothing an AT or a keyboard
    // user can activate — the sibling source-type chip is a real button.
    expect(chip.tagName.toLowerCase()).toBe('span')
    expect(chip).not.toHaveAttribute('role')
    expect(chip).not.toHaveAttribute('tabindex')
  })
})

describe('MatchDetailPanel — disruption chooser', () => {
  it('renders the three scenario chips + no Clear when unannotated', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: /I left/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ally left/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Enemy left/ })).toBeInTheDocument()
    expect(screen.queryByTitle('Remove the leaver annotation.')).not.toBeInTheDocument()
  })

  it('marks the active chip when an annotation is set', () => {
    const annotated = makeRecord({}, {
      annotation: { leavers: ['team'], throwers: [] },
    } as unknown as Partial<MatchRecord>)
    renderPanel({ record: annotated })
    const team = screen.getByRole('button', { name: /Ally left/ })
    expect(team).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTitle('Remove the leaver annotation.')).toBeInTheDocument()
  })

  it('writes the picked scenario via SetMatchAnnotation', async () => {
    const { key } = renderPanel()
    await user().click(screen.getByRole('button', { name: /I left/ }))
    expect(SetMatchAnnotation).toHaveBeenCalledWith(key, { leavers: ['self'], throwers: [], note: '', replay_code: '', members: [], tags: [] })
  })

  // Clearing the only populated field (leaver) leaves the annotation empty, so
  // it routes to DELETE — the explicit clear verb — not an all-empty PUT.
  it('clicking the active chip on a leaver-only annotation deletes it', async () => {
    const annotated = makeRecord({}, {
      annotation: { leavers: ['enemy'], throwers: [] },
    } as unknown as Partial<MatchRecord>)
    const { key } = renderPanel({ record: annotated })
    await user().click(screen.getByRole('button', { name: /Enemy left/ }))
    expect(DeleteMatchAnnotation).toHaveBeenCalledWith(key)
    expect(SetMatchAnnotation).not.toHaveBeenCalled()
  })

  it('clicking Clear on a leaver-only annotation deletes it', async () => {
    const annotated = makeRecord({}, {
      annotation: { leavers: ['self'], throwers: [] },
    } as unknown as Partial<MatchRecord>)
    const { key } = renderPanel({ record: annotated })
    await user().click(screen.getByTitle('Remove the leaver annotation.'))
    expect(DeleteMatchAnnotation).toHaveBeenCalledWith(key)
    expect(SetMatchAnnotation).not.toHaveBeenCalled()
  })

  // But clearing the leaver when OTHER content remains is still an upsert.
  it('clearing the leaver with a note present still PUTs', async () => {
    const annotated = makeRecord({}, {
      annotation: { leavers: ['enemy'], throwers: [], note: 'kept' },
    } as unknown as Partial<MatchRecord>)
    const { key } = renderPanel({ record: annotated })
    await user().click(screen.getByRole('button', { name: /Enemy left/ }))
    expect(SetMatchAnnotation).toHaveBeenCalledWith(key, { leavers: [], throwers: [], note: 'kept', replay_code: '', members: [], tags: [] })
    expect(DeleteMatchAnnotation).not.toHaveBeenCalled()
  })
})

describe('MatchDetailPanel — match notes / journal block', () => {
  it('renders all four cells (note / replay / group / tags)', () => {
    renderPanel()
    expect(screen.getByText('Note')).toBeInTheDocument()
    expect(screen.getByText('Replay code')).toBeInTheDocument()
    expect(screen.getByText('Group')).toBeInTheDocument()
    expect(screen.getByText('Tags')).toBeInTheDocument()
  })

  it('hydrates from record.annotation values on first render', () => {
    const rec = makeRecord({}, {
      annotation: { leavers: [], throwers: [], note: 'huge clutch', replay_code: 'A7B2C9', members: ['Apollo#1', 'Cheese#5'] },
    } as unknown as Partial<MatchRecord>)
    renderPanel({ record: rec })
    expect(screen.getByText('huge clutch')).toBeInTheDocument()
    // The read-only preview replaces the editor until clicked.
    expect(screen.queryByRole('group', { name: 'Note format' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Replay code')).toHaveValue('A7B2C9')
    expect(memberChips()).toEqual(['Apollo#1', 'Cheese#5'])
  })

  it('writes the annotation on note blur with the trimmed value', async () => {
    const { key } = renderPanel()
    // Markdown mode: this is the panel's commit-on-blur wiring, and the raw
    // field answers fireEvent.update where a document editor does not.
    const ta = await markdownField()
    await fireEvent.focus(ta)
    // fireEvent.update (v-model-aware) rather than per-keystroke typing:
    // the panel's store-reload microtasks can reset the draft between
    // awaited keystrokes, which no real user's blur would interleave with.
    await fireEvent.update(ta, '  draft text  ')
    await leaveWriter(ta)
    expect(SetMatchAnnotation).toHaveBeenCalledWith(key, { leavers: [], throwers: [], note: 'draft text', replay_code: '', members: [], tags: [], exclusion_reason: '' })
  })

  it('writes the annotation on replay-code Enter', async () => {
    const { key } = renderPanel()
    await user().type(screen.getByLabelText('Replay code'), '7H1K9P{Enter}')
    expect(SetMatchAnnotation).toHaveBeenCalledWith(key, { leavers: [], throwers: [], note: '', replay_code: '7H1K9P', members: [], tags: [], exclusion_reason: '' })
  })

  it('Enter on the member input adds a chip and writes the new list', async () => {
    renderPanel()
    await user().type(screen.getByPlaceholderText(/Add BattleTag/), 'Apollo#11234{Enter}')
    expect(memberChips()).toEqual(['Apollo#11234'])
    expect(lastAnnotation()).toEqual({ leavers: [], throwers: [], note: '', replay_code: '', members: ['Apollo#11234'], tags: [], exclusion_reason: '' })
  })

  it('comma key also commits the member chip', async () => {
    renderPanel()
    await user().type(screen.getByPlaceholderText(/Add BattleTag/), 'Cheese#5,')
    expect(memberChips()).toEqual(['Cheese#5'])
  })

  it('removing a chip writes the annotation without that member', async () => {
    const rec = makeRecord({}, {
      annotation: { leavers: [], throwers: [], note: '', replay_code: '', members: ['Apollo#1', 'Cheese#5'] },
    } as unknown as Partial<MatchRecord>)
    renderPanel({ record: rec })
    expect(memberChips()).toHaveLength(2)
    await user().click(screen.getByLabelText('Remove Apollo#1 from group'))
    expect(lastAnnotation()).toEqual({ leavers: [], throwers: [], note: '', replay_code: '', members: ['Cheese#5'], tags: [], exclusion_reason: '' })
  })

  it('Backspace on empty member input removes the last chip', async () => {
    const rec = makeRecord({}, {
      annotation: { leavers: [], throwers: [], note: '', replay_code: '', members: ['Apollo#1', 'Cheese#5'] },
    } as unknown as Partial<MatchRecord>)
    renderPanel({ record: rec })
    const memberInput = screen.getByPlaceholderText(/Add BattleTag/)
    expect(memberInput).toHaveValue('')
    await user().type(memberInput, '{Backspace}')
    expect(lastAnnotation()).toEqual({ leavers: [], throwers: [], note: '', replay_code: '', members: ['Apollo#1'], tags: [], exclusion_reason: '' })
  })

  it('Backspace with text in the input does NOT remove a chip', async () => {
    const rec = makeRecord({}, {
      annotation: { leavers: [], throwers: [], note: '', replay_code: '', members: ['Apollo#1', 'Cheese#5'] },
    } as unknown as Partial<MatchRecord>)
    renderPanel({ record: rec })
    const memberInput = screen.getByPlaceholderText(/Add BattleTag/)
    await user().type(memberInput, 'part{Backspace}')
    expect(SetMatchAnnotation).not.toHaveBeenCalled()
    expect(memberChips()).toHaveLength(2)
  })

  it('adding a duplicate BattleTag clears the input without writing', async () => {
    const rec = makeRecord({}, {
      annotation: { leavers: [], throwers: [], note: '', replay_code: '', members: ['Apollo#1'] },
    } as unknown as Partial<MatchRecord>)
    renderPanel({ record: rec })
    const memberInput = screen.getByPlaceholderText(/Add BattleTag/)
    await user().type(memberInput, 'Apollo#1{Enter}')
    expect(SetMatchAnnotation).not.toHaveBeenCalled()
    expect(memberInput).toHaveValue('')
    expect(memberChips()).toEqual(['Apollo#1'])
  })
})

describe('MatchDetailPanel — soft-delete flow', () => {
  it('shows the Hide button on a normal record', () => {
    renderPanel()
    expect(dangerGroup().getByRole('button', { name: /Hide/ })).toBeInTheDocument()
  })

  it('first Hide click reveals Confirm + Cancel; does NOT write yet', async () => {
    renderPanel()
    await user().click(dangerGroup().getByRole('button', { name: /Hide/ }))
    expect(dangerGroup().getByRole('button', { name: /Confirm/ })).toBeInTheDocument()
    expect(dangerGroup().getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(SetMatchVisibility).not.toHaveBeenCalled()
  })

  it('Confirm hides the match via SetMatchVisibility(key, true)', async () => {
    const { key } = renderPanel()
    await user().click(dangerGroup().getByRole('button', { name: /Hide/ }))
    await user().click(dangerGroup().getByRole('button', { name: /Confirm/ }))
    expect(SetMatchVisibility).toHaveBeenCalledWith(key, true)
  })

  it('Cancel resets the confirm state without writing', async () => {
    renderPanel()
    await user().click(dangerGroup().getByRole('button', { name: /Hide/ }))
    await user().click(dangerGroup().getByRole('button', { name: 'Cancel' }))
    expect(dangerGroup().getByRole('button', { name: /Hide/ })).toBeInTheDocument()
    expect(SetMatchVisibility).not.toHaveBeenCalled()
  })
})

// ── Pagination toolbar ───────────────────────────────────────────────
// The toolbar's ← / → buttons paginate the selection through the narrowed
// set. Seed three records and select the middle one so both directions are
// live; clicking moves `selection.selectedKey`.
describe('MatchDetailPanel — pagination toolbar', () => {
  function threeRecords() {
    return [
      makeRecord({ date: '2026-05-10', finished_at: '20:00' }, { match_key: 'm-a' }),
      makeRecord({ date: '2026-05-10', finished_at: '21:00' }, { match_key: 'm-b' }),
      makeRecord({ date: '2026-05-10', finished_at: '22:00' }, { match_key: 'm-c' }),
    ]
  }
  const prevBtn = () => screen.getByRole('button', { name: /Previous match \(left arrow\)/ })
  const nextBtn = () => screen.getByRole('button', { name: /Next match \(right arrow\)/ })

  it('the ← button steps the selection to the previous match', async () => {
    const records = threeRecords()
    const { ui } = renderPanel({ records, selectKey: 'm-b' })
    const before = ui.selection.selectedKey.value
    await user().click(prevBtn())
    expect(ui.selection.selectedKey.value).not.toBe(before)
    expect(['m-a', 'm-c']).toContain(ui.selection.selectedKey.value)
  })

  it('the → button steps the selection to the next match', async () => {
    const records = threeRecords()
    const { ui } = renderPanel({ records, selectKey: 'm-b' })
    const before = ui.selection.selectedKey.value
    await user().click(nextBtn())
    expect(ui.selection.selectedKey.value).not.toBe(before)
  })

  it('disables the ← / → buttons at the boundaries (single record)', () => {
    renderPanel()
    expect(prevBtn()).toBeDisabled()
    expect(nextBtn()).toBeDisabled()
  })

  it('renders the position-of-total indicator', () => {
    const records = threeRecords()
    renderPanel({ records, selectKey: 'm-c' })
    // The nav buttons surface the same position-of-total the visible
    // indicator shows.
    expect(screen.getByRole('button', { name: /Previous match \(left arrow\)\. Position 3 of 3/ })).toBeInTheDocument()
  })
})

describe('MatchDetailPanel — provenance banner', () => {
  // The banner's whole payload is the provenance badge (a named role=img)
  // plus a one-line summary; the is-edited / is-manual tints are the visual
  // echo of the same `source` the badge names.
  const provBadge = () => screen.queryByRole('img', { name: /^Source: / })

  it('shows no banner for a pure-OCR match', () => {
    renderPanel({ record: makeRecord({}, { source: 'ocr' }) })
    expect(provBadge()).not.toBeInTheDocument()
  })

  it('shows an "Edited" banner with the field count + a Reset-to-OCR button', () => {
    renderPanel({
      record: makeRecord({}, { source: 'ocr_edited', edited_fields: ['data.map', 'data.damage'] }),
    })
    expect(provBadge()).toHaveAccessibleName(/^Source: Edited\./)
    expect(screen.getByText('2 fields changed from the OCR scan.')).toBeInTheDocument()
    expect(screen.getByTitle('Discard every edit and restore the scanned (OCR) values')).toBeInTheDocument()
  })

  it('shows a "User entered" banner with NO reset button for a manual match', () => {
    renderPanel({ record: makeRecord({}, { source: 'manual' }) })
    expect(provBadge()).toHaveAccessibleName(/^Source: User entered\./)
    expect(screen.getByText('Logged by hand — no screenshots to parse.')).toBeInTheDocument()
    // Nothing to reset to — a manual match has no OCR baseline.
    expect(screen.queryByTitle('Discard every edit and restore the scanned (OCR) values')).not.toBeInTheDocument()
  })

  it('resets to OCR via ResetMatchData when Reset to OCR is clicked', async () => {
    renderPanel({
      record: makeRecord({}, { match_key: 'match-x', source: 'ocr_edited', edited_fields: ['data.map'] }),
    })
    await user().click(screen.getByTitle('Discard every edit and restore the scanned (OCR) values'))
    await flushPromises()
    expect(ResetMatchData).toHaveBeenCalledWith('match-x')
  })
})

describe('apply previous annotation', () => {
  function twoMatchSetup() {
    const prev = makeRecord({}, {
      match_key: 'match-2026-05-10T20-00-00',
      annotation: { leaver: '', members: ['Apollo', 'Zed'], tags: ['stack'] },
    } as unknown as Partial<MatchRecord>)
    const cur = makeRecord({ map: 'numbani' }, { match_key: 'match-2026-05-10T22-10-00' })
    return renderPanel({ records: [prev, cur], record: cur, selectKey: cur.match_key })
  }

  it('apply fills the journal draft chips without persisting; confirm persists once', async () => {
    twoMatchSetup()
    await user().click(screen.getByLabelText(/^Apply members and tags from/))
    expect(memberChips()).toEqual(['Apollo', 'Zed'])
    expect(SetMatchAnnotation).not.toHaveBeenCalled()

    await user().click(screen.getByLabelText(/^Confirm members and tags copied from/))
    await flushPromises()
    expect(SetMatchAnnotation).toHaveBeenCalledTimes(1)
    expect(SetMatchAnnotation).toHaveBeenCalledWith(
      'match-2026-05-10T22-10-00',
      expect.objectContaining({ members: ['Apollo', 'Zed'], tags: ['stack'] }),
    )
  })

  it('undo restores the draft and the button is absent without an annotated predecessor', async () => {
    twoMatchSetup()
    await user().click(screen.getByLabelText(/^Apply members and tags from/))
    await user().click(screen.getByLabelText('Undo the applied annotation'))
    expect(memberChips()).toHaveLength(0)
    expect(SetMatchAnnotation).not.toHaveBeenCalled()
  })

  it('the apply button is absent without an annotated predecessor', () => {
    // A lone match has nothing to copy from.
    renderPanel()
    expect(screen.queryByLabelText(/^Apply members and tags from/)).not.toBeInTheDocument()
  })
})
