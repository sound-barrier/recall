import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import MatchDetailPanel from '@/components/matches/detail/MatchDetailPanel.vue'
import { useUiStore } from '@/stores/ui'
import { useMatchesStore } from '@/stores/matches'
import { SetMatchAnnotation, SetMatchVisibility, ResetMatchData } from '@/api'
import type { MatchRecord } from '@/api'

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
  GetMatchResults:    vi.fn(async () => h.records),
  SetMatchAnnotation: vi.fn(async () => undefined),
  SetMatchVisibility: vi.fn(async () => undefined),
  ResetMatchData:     vi.fn(async () => undefined),
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

interface PanelMountOver {
  record?:        MatchRecord
  records?:       MatchRecord[]
  selectKey?:     string
  isSourcesOpen?: boolean
  previewOpen?:   Record<string, boolean>
  previewError?:  Record<string, boolean>
}

// Seeds the matches store with the record(s), opens the selection (the panel
// reads selectedRecord from the narrowed set), and flips the per-match
// preview/sources UI state the panel forwards to MatchCardExpanded.
function mountPanel(over: PanelMountOver = {}) {
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
  for (const [f, on] of Object.entries(over.previewOpen ?? {})) if (on) ui.preview.togglePreview(f)
  for (const [f, on] of Object.entries(over.previewError ?? {})) if (on) ui.preview.onPreviewError(f)
  const wrapper = mount(MatchDetailPanel)
  return { wrapper, ui, matches, record, key }
}

// The 2nd argument of the most recent SetMatchAnnotation call — the merged
// annotation row the panel's useMatchActions handler PUTs.
const lastAnnotation = () => (SetMatchAnnotation as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1]

describe('MatchDetailPanel — match stats + heroes + rank', () => {
  it('renders six stat cells in the Match Stats grid', () => {
    const { wrapper } = mountPanel()
    const stats = wrapper.findAll('.stat')
    expect(stats).toHaveLength(6)
    const damage = stats.find(s => s.text().includes('Damage'))!
    expect(damage.text()).toContain('7,200')
  })

  it('renders the Final Score meta when present', () => {
    const { wrapper } = mountPanel()
    const scoreCell = wrapper.find('.meta-cell-score')
    expect(scoreCell.exists()).toBe(true)
    expect(scoreCell.find('.meta-eyebrow').text()).toBe('Final Score')
    expect(scoreCell.find('.meta-value').text()).toBe('3-1')
  })

  it('renders heroes_played list with percent + play time + stats', () => {
    const { wrapper } = mountPanel()
    expect(wrapper.find('.hero-pct').text()).toBe('100%')
    expect(wrapper.find('.hero-time').text()).toBe('11:25')
    expect(wrapper.text()).toContain('weapon accuracy')
    expect(wrapper.text()).toContain('24')
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
    const { wrapper } = mountPanel({ record: rec })
    expect(wrapper.find('.rank-tier').text()).toContain('platinum 3')
    expect(wrapper.find('.rank-progress').text()).toBe('40% progress')
    expect(wrapper.find('.rank-change').text()).toBe('+5%')
    const modifiers = wrapper.findAll('.rank-modifier').map(m => m.text())
    expect(modifiers).toEqual(['expected', 'victory'])
    const srLines = wrapper.findAll('.sr-entry').map(e => e.text())
    expect(srLines.length).toBe(2)
    expect(srLines[0]).toContain('lucio')
    expect(srLines[0]).toContain('3200')
    expect(srLines[0]).toContain('+30')
    expect(srLines[1]).toContain('-10')
  })
})

describe('MatchDetailPanel — sources panel', () => {
  it('renders the sources toggle with file count', () => {
    const { wrapper } = mountPanel()
    expect(wrapper.find('.sources-toggle').exists()).toBe(true)
    expect(wrapper.find('.sources-count').text()).toBe('2')
  })

  it('clicking the sources toggle flips the shared sources-open state', async () => {
    const { wrapper, ui, key } = mountPanel()
    expect(ui.isSourcesOpen(key)).toBe(false)
    await wrapper.find('.sources-toggle').trigger('click')
    expect(ui.isSourcesOpen(key)).toBe(true)
  })

  it('renders the source-file list only when sources are open', () => {
    expect(mountPanel().wrapper.find('.sources').exists()).toBe(false)
    expect(mountPanel({ isSourcesOpen: true }).wrapper.find('.sources').exists()).toBe(true)
  })

  it('source-type chips render from source_types map', () => {
    const { wrapper } = mountPanel({ isSourcesOpen: true })
    const chips = wrapper.findAll('.source-type-chip').map(c => c.text())
    // "teams" labels as "TEAMS" everywhere in the UI.
    expect(chips).toEqual(['SUMMARY', 'TEAMS'])
  })

  it('clicking a source filename opens that file in the preview state', async () => {
    const { wrapper, ui } = mountPanel({ isSourcesOpen: true })
    expect(ui.preview.isPreviewOpen('summary.png')).toBe(false)
    await wrapper.find('.source-name').trigger('click')
    expect(ui.preview.isPreviewOpen('summary.png')).toBe(true)
  })

  it('renders <img> when previewOpen[file]=true and no error', () => {
    const { wrapper } = mountPanel({
      isSourcesOpen: true,
      previewOpen: { 'summary.png': true },
    })
    const imgs = wrapper.findAll('img.source-preview')
    expect(imgs).toHaveLength(1)
    const src = imgs[0]!.attributes('src')
    // URL shape: /_screenshot/<dir-id>/<filename>. Test record has
    // no source_dir_ids so dir-id is 0 (configured-folder fallback).
    expect(src).toContain('/_screenshot/0/summary.png')
  })

  it('renders preview error message when previewError[file]=true', () => {
    const { wrapper } = mountPanel({
      isSourcesOpen: true,
      previewOpen: { 'summary.png': true },
      previewError: { 'summary.png': true },
    })
    expect(wrapper.find('img.source-preview').exists()).toBe(false)
    expect(wrapper.find('.source-preview-error').text()).toContain('Could not load image')
  })

  it('img @error records a preview error in the shared state', async () => {
    const { wrapper, ui } = mountPanel({
      isSourcesOpen: true,
      previewOpen: { 'summary.png': true },
    })
    await wrapper.find('img.source-preview').trigger('error')
    expect(ui.preview.hasPreviewError('summary.png')).toBe(true)
  })

  it('shows the "missing required" explainer when sources open and slots are absent', () => {
    // Drop the scoreboard source so the SCOREBOARD slot is reported
    // missing; SUMMARY stays present.
    const rec = makeRecord({}, {
      source_files: ['summary.png'],
      source_types: { 'summary.png': 'summary' },
    } as unknown as Partial<MatchRecord>)
    const { wrapper } = mountPanel({ record: rec, isSourcesOpen: true })
    const explain = wrapper.find('.sources-explain')
    expect(explain.exists()).toBe(true)
    expect(explain.text()).toContain('TEAMS missing')
  })
})

describe('MatchDetailPanel — parsed timestamps', () => {
  it('renders the match-level "Parsed" meta row when parsed_at is set', () => {
    const rec = makeRecord({}, { parsed_at: '2026-05-10T21:30:00Z' })
    const { wrapper } = mountPanel({ record: rec })
    const parsedCell = wrapper.find('.meta-cell-parsed')
    expect(parsedCell.exists()).toBe(true)
    expect(parsedCell.text()).toContain('Parsed')
    expect(parsedCell.find('.meta-value').attributes('title')).toBe('2026-05-10T21:30:00Z')
  })

  it('does NOT render the Parsed row when parsed_at is missing (pre-migration rows)', () => {
    const rec = makeRecord({}, { parsed_at: undefined })
    const { wrapper } = mountPanel({ record: rec })
    expect(wrapper.find('.meta-cell-parsed').exists()).toBe(false)
  })

  it('renders a per-source-file parsed chip in the Sources panel', () => {
    const rec = makeRecord({}, {
      source_parsed_at: {
        'summary.png': '2026-05-10T21:30:00Z',
        'scoreboard.png': '2026-05-10T21:30:05Z',
      },
    })
    const { wrapper } = mountPanel({ record: rec, isSourcesOpen: true })
    const chips = wrapper.findAll('.source-parsed-chip')
    expect(chips).toHaveLength(2)
    expect(chips[0]!.attributes('title')).toContain('2026-05-10T21:30:00Z')
  })

  it('omits the per-source chip for files missing from source_parsed_at', () => {
    const rec = makeRecord({}, {
      source_parsed_at: { 'summary.png': '2026-05-10T21:30:00Z' },
    })
    const { wrapper } = mountPanel({ record: rec, isSourcesOpen: true })
    expect(wrapper.findAll('.source-parsed-chip')).toHaveLength(1)
  })

  it('the per-source chip is NOT a filter trigger (no click handler, no clickable class)', () => {
    const rec = makeRecord({}, {
      source_parsed_at: { 'summary.png': '2026-05-10T21:30:00Z' },
    })
    const { wrapper } = mountPanel({ record: rec, isSourcesOpen: true })
    const chip = wrapper.find('.source-parsed-chip')
    expect(chip.classes()).not.toContain('clickable')
    expect(chip.element.tagName.toLowerCase()).toBe('span')
  })
})

describe('MatchDetailPanel — leaver chooser', () => {
  it('renders the three scenario chips + no Clear when unannotated', () => {
    const { wrapper } = mountPanel()
    const chipTexts = wrapper.findAll('.leaver-chip').map(c => c.text())
    // Each chip's text includes its glyph prefix (⊘ / ↙ / ↗).
    expect(chipTexts.some(t => t.includes('I left'))).toBe(true)
    expect(chipTexts.some(t => t.includes('Ally left'))).toBe(true)
    expect(chipTexts.some(t => t.includes('Enemy left'))).toBe(true)
    expect(wrapper.find('.leaver-chip.leaver-clear').exists()).toBe(false)
  })

  it('marks the active chip when an annotation is set', () => {
    const annotated = makeRecord({}, {
      annotation: { leaver: 'team' },
    } as unknown as Partial<MatchRecord>)
    const { wrapper } = mountPanel({ record: annotated })
    const team = wrapper.findAll('.leaver-chip').find(c => c.text().includes('Ally left'))!
    expect(team.classes()).toContain('active')
    expect(team.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('.leaver-chip.leaver-clear').exists()).toBe(true)
  })

  it('writes the picked scenario via SetMatchAnnotation', async () => {
    const { wrapper, key } = mountPanel()
    const self = wrapper.findAll('.leaver-chip').find(c => c.text().includes('I left'))!
    await self.trigger('click')
    expect(SetMatchAnnotation).toHaveBeenCalledWith(key, { leaver: 'self', note: '', replay_code: '', members: [], tags: [] })
  })

  it('clicking the active chip writes a clear (empty leaver)', async () => {
    const annotated = makeRecord({}, {
      annotation: { leaver: 'enemy' },
    } as unknown as Partial<MatchRecord>)
    const { wrapper } = mountPanel({ record: annotated })
    const enemy = wrapper.findAll('.leaver-chip').find(c => c.text().includes('Enemy'))!
    await enemy.trigger('click')
    expect(lastAnnotation()).toEqual({ leaver: '', note: '', replay_code: '', members: [], tags: [] })
  })

  it('clicking Clear writes with empty leaver', async () => {
    const annotated = makeRecord({}, {
      annotation: { leaver: 'self' },
    } as unknown as Partial<MatchRecord>)
    const { wrapper } = mountPanel({ record: annotated })
    const clear = wrapper.find('.leaver-chip.leaver-clear')
    await clear.trigger('click')
    expect(lastAnnotation()).toEqual({ leaver: '', note: '', replay_code: '', members: [], tags: [] })
  })
})

describe('MatchDetailPanel — match notes / journal block', () => {
  it('renders all four cells (note / replay / group / tags)', () => {
    const { wrapper } = mountPanel()
    expect(wrapper.find('.match-journal').exists()).toBe(true)
    const labels = wrapper.findAll('.journal-eyebrow').map(l => l.text().split(/\s+/)[0])
    expect(labels).toEqual(['Note', 'Replay', 'Group', 'Tags'])
  })

  it('hydrates from record.annotation values on first render', () => {
    const rec = makeRecord({}, {
      annotation: { leaver: '', note: 'huge clutch', replay_code: 'A7B2C9', members: ['Apollo#1', 'Cheese#5'] },
    } as unknown as Partial<MatchRecord>)
    const { wrapper } = mountPanel({ record: rec })
    const preview = wrapper.find('.match-notes-preview')
    expect(preview.exists()).toBe(true)
    expect(preview.text()).toBe('huge clutch')
    expect(wrapper.find('.match-notes-textarea').exists()).toBe(false)
    const replay = wrapper.find('.match-notes-input.mono').element as HTMLInputElement
    expect(replay.value).toBe('A7B2C9')
    expect(wrapper.findAll('.member-chip-tag').map(c => c.text())).toEqual(['Apollo#1', 'Cheese#5'])
  })

  it('writes the annotation on note blur with the trimmed value', async () => {
    const { wrapper, key } = mountPanel()
    const ta = wrapper.find('.match-notes-textarea')
    await ta.setValue('  draft text  ')
    await ta.trigger('blur')
    expect(SetMatchAnnotation).toHaveBeenCalledWith(key, { leaver: '', note: 'draft text', replay_code: '', members: [], tags: [] })
  })

  it('writes the annotation on replay-code Enter', async () => {
    const { wrapper, key } = mountPanel()
    const replay = wrapper.find('.match-notes-input.mono')
    await replay.setValue('7H1K9P')
    await replay.trigger('keydown.enter')
    expect(SetMatchAnnotation).toHaveBeenCalledWith(key, { leaver: '', note: '', replay_code: '7H1K9P', members: [], tags: [] })
  })

  it('Enter on the member input adds a chip and writes the new list', async () => {
    const { wrapper } = mountPanel()
    const memberInput = wrapper.find('.member-input')
    await memberInput.setValue('Apollo#11234')
    await memberInput.trigger('keydown', { key: 'Enter' })
    expect(wrapper.findAll('.member-chip-tag').map(c => c.text())).toEqual(['Apollo#11234'])
    expect(lastAnnotation()).toEqual({ leaver: '', note: '', replay_code: '', members: ['Apollo#11234'], tags: [] })
  })

  it('comma key also commits the member chip', async () => {
    const { wrapper } = mountPanel()
    const memberInput = wrapper.find('.member-input')
    await memberInput.setValue('Cheese#5')
    await memberInput.trigger('keydown', { key: ',' })
    expect(wrapper.findAll('.member-chip-tag').map(c => c.text())).toEqual(['Cheese#5'])
  })

  it('removing a chip writes the annotation without that member', async () => {
    const rec = makeRecord({}, {
      annotation: { leaver: '', note: '', replay_code: '', members: ['Apollo#1', 'Cheese#5'] },
    } as unknown as Partial<MatchRecord>)
    const { wrapper } = mountPanel({ record: rec })
    const xButtons = wrapper.findAll('.member-chip-remove')
    expect(xButtons).toHaveLength(2)
    await xButtons[0]!.trigger('click')
    expect(lastAnnotation()).toEqual({ leaver: '', note: '', replay_code: '', members: ['Cheese#5'], tags: [] })
  })

  it('Backspace on empty member input removes the last chip', async () => {
    const rec = makeRecord({}, {
      annotation: { leaver: '', note: '', replay_code: '', members: ['Apollo#1', 'Cheese#5'] },
    } as unknown as Partial<MatchRecord>)
    const { wrapper } = mountPanel({ record: rec })
    const memberInput = wrapper.find('.member-input')
    expect((memberInput.element as HTMLInputElement).value).toBe('')
    await memberInput.trigger('keydown', { key: 'Backspace' })
    expect(lastAnnotation()).toEqual({ leaver: '', note: '', replay_code: '', members: ['Apollo#1'], tags: [] })
  })

  it('Backspace with text in the input does NOT remove a chip', async () => {
    const rec = makeRecord({}, {
      annotation: { leaver: '', note: '', replay_code: '', members: ['Apollo#1', 'Cheese#5'] },
    } as unknown as Partial<MatchRecord>)
    const { wrapper } = mountPanel({ record: rec })
    const memberInput = wrapper.find('.member-input')
    await memberInput.setValue('part')
    await memberInput.trigger('keydown', { key: 'Backspace' })
    expect(SetMatchAnnotation).not.toHaveBeenCalled()
    expect(wrapper.findAll('.member-chip-tag')).toHaveLength(2)
  })

  it('adding a duplicate BattleTag clears the input without writing', async () => {
    const rec = makeRecord({}, {
      annotation: { leaver: '', note: '', replay_code: '', members: ['Apollo#1'] },
    } as unknown as Partial<MatchRecord>)
    const { wrapper } = mountPanel({ record: rec })
    const memberInput = wrapper.find('.member-input')
    await memberInput.setValue('Apollo#1')
    await memberInput.trigger('keydown', { key: 'Enter' })
    expect(SetMatchAnnotation).not.toHaveBeenCalled()
    expect((memberInput.element as HTMLInputElement).value).toBe('')
    expect(wrapper.findAll('.member-chip-tag').map(c => c.text())).toEqual(['Apollo#1'])
  })
})

describe('MatchDetailPanel — soft-delete flow', () => {
  it('shows the Hide button on a normal record', () => {
    const { wrapper } = mountPanel()
    const hide = wrapper.findAll('.danger-btn').find(b => b.text().includes('Hide'))
    expect(hide).toBeDefined()
  })

  it('first Hide click reveals Confirm + Cancel; does NOT write yet', async () => {
    const { wrapper } = mountPanel()
    const hide = wrapper.findAll('.danger-btn').find(b => b.text().includes('Hide'))!
    await hide.trigger('click')
    const buttons = wrapper.findAll('.danger-btn').map(b => b.text())
    expect(buttons.some(t => t.includes('Confirm'))).toBe(true)
    expect(buttons.some(t => t === 'Cancel')).toBe(true)
    expect(SetMatchVisibility).not.toHaveBeenCalled()
  })

  it('Confirm hides the match via SetMatchVisibility(key, true)', async () => {
    const { wrapper, key } = mountPanel()
    await wrapper.findAll('.danger-btn').find(b => b.text().includes('Hide'))!.trigger('click')
    await wrapper.findAll('.danger-btn').find(b => b.text().includes('Confirm'))!.trigger('click')
    expect(SetMatchVisibility).toHaveBeenCalledWith(key, true)
  })

  it('Cancel resets the confirm state without writing', async () => {
    const { wrapper } = mountPanel()
    await wrapper.findAll('.danger-btn').find(b => b.text().includes('Hide'))!.trigger('click')
    await wrapper.findAll('.danger-btn').find(b => b.text() === 'Cancel')!.trigger('click')
    expect(wrapper.find('.danger-btn').text()).toContain('Hide')
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
  const navButtonsOf = (w: ReturnType<typeof mountPanel>['wrapper']) =>
    w.find('.detail-toolbar-nav').findAll('.detail-icon-btn')

  it('the ← button steps the selection to the previous match', async () => {
    const records = threeRecords()
    const { wrapper, ui } = mountPanel({ records, selectKey: 'm-b' })
    const before = ui.selection.selectedKey.value
    await navButtonsOf(wrapper)[0]!.trigger('click')
    expect(ui.selection.selectedKey.value).not.toBe(before)
    expect(['m-a', 'm-c']).toContain(ui.selection.selectedKey.value)
  })

  it('the → button steps the selection to the next match', async () => {
    const records = threeRecords()
    const { wrapper, ui } = mountPanel({ records, selectKey: 'm-b' })
    const before = ui.selection.selectedKey.value
    await navButtonsOf(wrapper)[1]!.trigger('click')
    expect(ui.selection.selectedKey.value).not.toBe(before)
  })

  it('disables the ← / → buttons at the boundaries (single record)', () => {
    const { wrapper } = mountPanel()
    const btns = navButtonsOf(wrapper)
    expect(btns[0]!.attributes('disabled')).toBeDefined()
    expect(btns[1]!.attributes('disabled')).toBeDefined()
  })

  it('renders the position-of-total indicator', () => {
    const records = threeRecords()
    const { wrapper } = mountPanel({ records, selectKey: 'm-c' })
    expect(wrapper.find('.detail-pos').text()).toContain('3')
    expect(wrapper.find('.detail-pos-of').text()).toContain('3')
  })
})

describe('MatchDetailPanel — provenance banner', () => {
  it('shows no banner for a pure-OCR match', () => {
    const { wrapper } = mountPanel({ record: makeRecord({}, { source: 'ocr' }) })
    expect(wrapper.find('[data-prov-banner]').exists()).toBe(false)
  })

  it('shows an "Edited" banner with the field count + a Reset-to-OCR button', () => {
    const { wrapper } = mountPanel({
      record: makeRecord({}, { source: 'ocr_edited', edited_fields: ['data.map', 'data.damage'] }),
    })
    const banner = wrapper.find('[data-prov-banner]')
    expect(banner.exists()).toBe(true)
    expect(banner.classes()).toContain('is-edited')
    expect(banner.text()).toContain('Edited')
    expect(banner.find('.detail-prov-sub').text()).toContain('2 fields')
    expect(banner.find('.detail-reset-btn').exists()).toBe(true)
  })

  it('shows a "User entered" banner with NO reset button for a manual match', () => {
    const { wrapper } = mountPanel({ record: makeRecord({}, { source: 'manual' }) })
    const banner = wrapper.find('[data-prov-banner]')
    expect(banner.exists()).toBe(true)
    expect(banner.classes()).toContain('is-manual')
    expect(banner.text()).toContain('User entered')
    // Nothing to reset to — a manual match has no OCR baseline.
    expect(banner.find('.detail-reset-btn').exists()).toBe(false)
  })

  it('resets to OCR via ResetMatchData when Reset to OCR is clicked', async () => {
    const { wrapper } = mountPanel({
      record: makeRecord({}, { match_key: 'match-x', source: 'ocr_edited', edited_fields: ['data.map'] }),
    })
    await wrapper.find('[data-prov-banner] .detail-reset-btn').trigger('click')
    await flushPromises()
    expect(ResetMatchData).toHaveBeenCalledWith('match-x')
  })
})
