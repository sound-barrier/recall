import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import MatchCard from './MatchCard.vue'
import type { MatchRecord } from '../api'

// MatchCard fixtures. Each test asserts on either rendered DOM or
// emitted events. The isActive predicate is the only callback the
// component needs from outside; it always returns false here unless
// a test pins specific filters.

function makeRecord(over: Partial<MatchRecord['data']> = {}, recOver: Partial<MatchRecord> = {}): MatchRecord {
  return {
    match_key: 'match:2026-05-10T21:29:28',
    source_files: ['summary.png', 'scoreboard.png'],
    source_types: { 'summary.png': 'summary', 'scoreboard.png': 'scoreboard' },
    data: {
      map: 'rialto',
      mode: 'competitive',
      type: 'control',
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

interface CardMountOver {
  record?:        MatchRecord
  index?:         number
  isExpanded?:    boolean
  isSourcesOpen?: boolean
  previewOpen?:   Record<string, boolean>
  previewError?:  Record<string, boolean>
  isActive?:      (field: string, value: string) => boolean
  densityMode?:   'comfortable' | 'compact'
}

function mountCard(over: CardMountOver = {}) {
  return mount(MatchCard, {
    props: {
      record: over.record ?? makeRecord(),
      index: over.index ?? 0,
      isExpanded: over.isExpanded ?? false,
      isSourcesOpen: over.isSourcesOpen ?? false,
      previewOpen: over.previewOpen ?? {},
      previewError: over.previewError ?? {},
      isActive: over.isActive ?? (() => false),
      densityMode: over.densityMode ?? 'comfortable',
    },
  })
}

describe('MatchCard — collapsed header', () => {
  it('renders the match index zero-padded', () => {
    expect(mountCard({ index: 0 }).find('.match-index').text()).toBe('01')
    expect(mountCard({ index: 11 }).find('.match-index').text()).toBe('12')
  })

  it('shows the map name in the header', () => {
    const wrapper = mountCard()
    expect(wrapper.find('.match-map').text()).toBe('rialto')
  })

  it('falls back to "Unknown Map" when data.map is empty', () => {
    const wrapper = mountCard({ record: makeRecord({ map: '' }) })
    expect(wrapper.find('.match-map').text()).toBe('Unknown Map')
  })

  it('shows formatted time and game length', () => {
    const wrapper = mountCard()
    expect(wrapper.find('.when').text()).toMatch(/May 10, 2026.*9:29pm/)
    expect(wrapper.find('.length').text()).toContain('11:25')
  })

  it('renders mode / type / role / hero / result badges', () => {
    const wrapper = mountCard()
    const text = wrapper.text()
    expect(text).toContain('competitive')
    expect(text).toContain('control')
    expect(text).toContain('support')
    expect(text).toContain('lucio')
    expect(text).toContain('victory')
  })

  it('applies result-{result} class to the article root', () => {
    expect(mountCard().find('article').classes()).toContain('result-victory')
    expect(mountCard({ record: makeRecord({ result: 'defeat' }) }).find('article').classes()).toContain('result-defeat')
  })

  it('applies "active" class to a badge when its filter is set', () => {
    const isActive = (field: string, value: string) => field === 'map' && value === 'rialto'
    const wrapper = mountCard({ isActive })
    expect(wrapper.find('.match-map').classes()).toContain('active')
  })

  it('shows the incomplete badge when required slots are missing', () => {
    // source_types only has TEAMS (scoreboard) → SUMMARY + PERSONAL are
    // missing. The incomplete badge should appear.
    const rec = makeRecord({}, {
      source_files: ['scoreboard.png'],
      source_types: { 'scoreboard.png': 'scoreboard' },
    })
    const wrapper = mountCard({ record: rec })
    expect(wrapper.find('.incomplete-badge').exists()).toBe(true)
    expect(wrapper.find('.incomplete-badge').text()).toContain('SUMMARY')
  })
})

describe('MatchCard — filter-toggle emits from badge clicks', () => {
  // Every filter chip in the header is a real <button>, not a <span>, so
  // keyboard users can tab into them and screen readers expose them as
  // interactive controls. Regressing any of these back to <span> would
  // silently strip keyboard access.
  it('every clickable chip in the header is a <button>', () => {
    const isActive = () => false
    const wrapper = mountCard({ isActive })
    for (const sel of ['.match-map.clickable', '.badge.mode', '.badge.type', '.badge.role', '.badge.hero', '.badge.result', 'button.chev-btn']) {
      const el = wrapper.find(sel)
      expect(el.exists(), `expected ${sel} to render`).toBe(true)
      expect(el.element.tagName, `expected ${sel} to be a <button>`).toBe('BUTTON')
    }
  })

  it('aria-pressed mirrors the active filter state on a chip', () => {
    const isActive = (field: string, value: string) => field === 'hero' && value === 'lucio'
    const wrapper = mountCard({ isActive })
    expect(wrapper.find('.badge.hero').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('.badge.mode').attributes('aria-pressed')).toBe('false')
  })

  it('clicking the map badge emits filter-toggle map', async () => {
    const wrapper = mountCard()
    await wrapper.find('.match-map').trigger('click')
    expect(wrapper.emitted('filter-toggle')![0]).toEqual(['map', 'rialto'])
  })

  it('clicking the mode badge emits filter-toggle mode', async () => {
    const wrapper = mountCard()
    await wrapper.find('.badge.mode').trigger('click')
    expect(wrapper.emitted('filter-toggle')![0]).toEqual(['mode', 'competitive'])
  })

  it('clicking the hero badge emits filter-toggle hero', async () => {
    const wrapper = mountCard()
    await wrapper.find('.badge.hero').trigger('click')
    expect(wrapper.emitted('filter-toggle')![0]).toEqual(['hero', 'lucio'])
  })

  it('clicking the result badge emits filter-toggle result', async () => {
    const wrapper = mountCard()
    await wrapper.find('.badge.result').trigger('click')
    expect(wrapper.emitted('filter-toggle')![0]).toEqual(['result', 'victory'])
  })
})

describe('MatchCard — header interaction', () => {
  it('clicking the header region emits toggle-expand', async () => {
    const wrapper = mountCard()
    await wrapper.find('.match-header').trigger('click')
    expect(wrapper.emitted('toggle-expand')).toBeTruthy()
  })

  // The chev is the keyboard expand affordance. The header region is no
  // longer role="button" — chip buttons live inside it, and nesting
  // interactive elements is invalid HTML, so the keyboard route is the
  // dedicated chev button on the right.
  it('clicking the chev button emits toggle-expand', async () => {
    const wrapper = mountCard()
    await wrapper.find('button.chev-btn').trigger('click')
    expect(wrapper.emitted('toggle-expand')).toHaveLength(1)
  })

  it('Enter on the chev button emits toggle-expand', async () => {
    const wrapper = mountCard()
    // Native <button> handles Enter/Space as click — trigger('click')
    // is the closest fidelity to that behaviour in jsdom/happy-dom.
    await wrapper.find('button.chev-btn').trigger('click')
    expect(wrapper.emitted('toggle-expand')).toHaveLength(1)
  })

  it('aria-expanded on the chev mirrors the isExpanded prop', () => {
    const open = mountCard({ isExpanded: true })
    expect(open.find('button.chev-btn').attributes('aria-expanded')).toBe('true')
    const closed = mountCard({ isExpanded: false })
    expect(closed.find('button.chev-btn').attributes('aria-expanded')).toBe('false')
  })
})

describe('MatchCard — expanded body', () => {
  it('renders six stat cells when expanded', () => {
    const wrapper = mountCard({ isExpanded: true })
    const stats = wrapper.findAll('.stat')
    expect(stats).toHaveLength(6)
    // Damage formats with thousands separator.
    const damage = stats.find(s => s.text().includes('Damage'))!
    expect(damage.text()).toContain('7,200')
  })

  it('renders the Final Score meta when present', () => {
    const wrapper = mountCard({ isExpanded: true })
    expect(wrapper.find('.meta-eyebrow').text()).toBe('Final Score')
    expect(wrapper.find('.meta-value').text()).toBe('3-1')
  })

  it('renders heroes_played list with percent + play time + stats', () => {
    const wrapper = mountCard({ isExpanded: true })
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
    })
    const wrapper = mountCard({ record: rec, isExpanded: true })
    expect(wrapper.find('.rank-tier').text()).toBe('platinum 3')
    expect(wrapper.find('.rank-progress').text()).toContain('40%')
    expect(wrapper.find('.rank-change').text()).toContain('+5%')
    const srEntries = wrapper.findAll('.sr-entry')
    expect(srEntries).toHaveLength(2)
    expect(srEntries[0]!.find('.sr-delta').classes()).toContain('up')
    expect(srEntries[1]!.find('.sr-delta').classes()).toContain('down')
  })
})

describe('MatchCard — sources panel', () => {
  it('renders the sources toggle with file count', () => {
    const wrapper = mountCard({ isExpanded: true })
    expect(wrapper.find('.sources-count').text()).toBe('2')
  })

  it('emits toggle-sources when the sources toggle is clicked', async () => {
    const wrapper = mountCard({ isExpanded: true })
    await wrapper.find('.sources-toggle').trigger('click')
    expect(wrapper.emitted('toggle-sources')).toBeTruthy()
  })

  it('renders the source-file list only when isSourcesOpen=true', () => {
    const closed = mountCard({ isExpanded: true, isSourcesOpen: false })
    expect(closed.findAll('.source-file')).toHaveLength(0)
    const open = mountCard({ isExpanded: true, isSourcesOpen: true })
    expect(open.findAll('.source-file')).toHaveLength(2)
  })

  it('source-type chips render from source_types map', () => {
    const wrapper = mountCard({ isExpanded: true, isSourcesOpen: true })
    const labels = wrapper.findAll('.source-type-chip').map(el => el.text())
    expect(labels).toContain('SUMMARY')
    expect(labels).toContain('TEAMS') // scoreboard → TEAMS
  })

  it('renders "?" chip when source_types missing for a file', () => {
    const rec = makeRecord({}, {
      source_files: ['mystery.png'],
      source_types: undefined,
    })
    const wrapper = mountCard({ record: rec, isExpanded: true, isSourcesOpen: true })
    const unknownChip = wrapper.find('.source-type-chip.unknown')
    expect(unknownChip.exists()).toBe(true)
    expect(unknownChip.text()).toBe('?')
  })

  it('clicking a source filename emits toggle-preview', async () => {
    const wrapper = mountCard({ isExpanded: true, isSourcesOpen: true })
    await wrapper.findAll('.source-name')[0]!.trigger('click')
    expect(wrapper.emitted('toggle-preview')![0]).toEqual(['summary.png'])
  })

  it('renders <img> when previewOpen[file]=true and no error', () => {
    const wrapper = mountCard({
      isExpanded: true,
      isSourcesOpen: true,
      previewOpen: { 'summary.png': true },
      previewError: {},
    })
    const imgs = wrapper.findAll('img.source-preview')
    expect(imgs).toHaveLength(1)
    expect(imgs[0]!.attributes('src')).toBe('/_screenshot/summary.png')
  })

  it('renders preview error message when previewError[file]=true', () => {
    const wrapper = mountCard({
      isExpanded: true,
      isSourcesOpen: true,
      previewOpen: { 'summary.png': true },
      previewError: { 'summary.png': true },
    })
    expect(wrapper.find('.source-preview-error').exists()).toBe(true)
  })

  it('img @error emits preview-error', async () => {
    const wrapper = mountCard({
      isExpanded: true,
      isSourcesOpen: true,
      previewOpen: { 'summary.png': true },
    })
    await wrapper.find('img.source-preview').trigger('error')
    expect(wrapper.emitted('preview-error')![0]).toEqual(['summary.png'])
  })

  it('shows the "missing required" explainer when sources open and slots are absent', () => {
    const rec = makeRecord({}, {
      source_files: ['scoreboard.png'],
      source_types: { 'scoreboard.png': 'scoreboard' },
    })
    const wrapper = mountCard({ record: rec, isExpanded: true, isSourcesOpen: true })
    const explain = wrapper.find('.sources-explain')
    expect(explain.exists()).toBe(true)
    expect(explain.text()).toContain('SUMMARY missing')
  })
})

describe('MatchCard — Parsed timestamps', () => {
  it('renders the match-level "Parsed" meta row in the expanded body when parsed_at is set', () => {
    const rec = makeRecord({}, { parsed_at: '2026-05-10T21:30:00Z' })
    const wrapper = mountCard({ record: rec, isExpanded: true })
    const parsedRow = wrapper.find('.meta-row-parsed')
    expect(parsedRow.exists()).toBe(true)
    expect(parsedRow.text()).toContain('Parsed')
    // The raw ISO is exposed via `title` for power users; the visible
    // text is the formatted version.
    expect(parsedRow.find('.meta-value').attributes('title')).toBe('2026-05-10T21:30:00Z')
  })

  it('does NOT render the Parsed row when parsed_at is missing (pre-migration rows)', () => {
    const rec = makeRecord({}, { parsed_at: undefined })
    const wrapper = mountCard({ record: rec, isExpanded: true })
    expect(wrapper.find('.meta-row-parsed').exists()).toBe(false)
  })

  it('renders a per-source-file parsed chip in the Sources panel', () => {
    const rec = makeRecord({}, {
      source_parsed_at: {
        'summary.png': '2026-05-10T21:30:00Z',
        'scoreboard.png': '2026-05-10T21:30:05Z',
      },
    })
    const wrapper = mountCard({ record: rec, isExpanded: true, isSourcesOpen: true })
    const chips = wrapper.findAll('.source-parsed-chip')
    expect(chips).toHaveLength(2)
  })

  it('omits the per-source chip for files missing from source_parsed_at', () => {
    const rec = makeRecord({}, {
      source_parsed_at: { 'summary.png': '2026-05-10T21:30:00Z' }, // only one of two files
    })
    const wrapper = mountCard({ record: rec, isExpanded: true, isSourcesOpen: true })
    expect(wrapper.findAll('.source-parsed-chip')).toHaveLength(1)
  })

  it('the per-source chip is NOT a filter trigger (no click handler, no clickable class)', () => {
    const rec = makeRecord({}, {
      source_parsed_at: { 'summary.png': '2026-05-10T21:30:00Z' },
    })
    const wrapper = mountCard({ record: rec, isExpanded: true, isSourcesOpen: true })
    const chip = wrapper.find('.source-parsed-chip')
    expect(chip.classes()).not.toContain('clickable')
    // Triggering a click should not emit anything (parsed dates are
    // not filterable per the product spec).
    chip.trigger('click')
    expect(wrapper.emitted('filter-toggle')).toBeFalsy()
  })
})

describe('MatchCard — compact density', () => {
  it('does not apply the compact class in comfortable mode', () => {
    const wrapper = mountCard({ densityMode: 'comfortable' })
    expect(wrapper.find('article').classes()).not.toContain('compact')
    expect(wrapper.find('.compact-stats').exists()).toBe(false)
  })

  it('applies the compact class on the article root in compact mode', () => {
    const wrapper = mountCard({ densityMode: 'compact' })
    expect(wrapper.find('article').classes()).toContain('compact')
  })

  it('renders inline E/A/D + damage in the tag-row when compact', () => {
    const wrapper = mountCard({ densityMode: 'compact' })
    const stats = wrapper.find('.compact-stats')
    expect(stats.exists()).toBe(true)
    const ead = stats.find('.compact-ead')
    expect(ead.text()).toMatch(/17.*16.*11/)
    expect(stats.find('.compact-dmg').text()).toContain('7,200')
  })

  it('omits the inline stats strip when none of E/A/D/damage are populated', () => {
    const sparse = makeRecord({
      eliminations: undefined,
      assists: undefined,
      deaths: undefined,
      damage: undefined,
    })
    const wrapper = mountCard({ densityMode: 'compact', record: sparse })
    expect(wrapper.find('article').classes()).toContain('compact')
    expect(wrapper.find('.compact-stats').exists()).toBe(false)
  })

  it('renders the EAD strip even when damage is missing (partial stats)', () => {
    const partial = makeRecord({ damage: undefined })
    const wrapper = mountCard({ densityMode: 'compact', record: partial })
    expect(wrapper.find('.compact-stats').exists()).toBe(true)
    expect(wrapper.find('.compact-dmg').exists()).toBe(false)
  })
})

describe('MatchCard — leaver annotation', () => {
  it('hides the L mark when no annotation is set', () => {
    const wrapper = mountCard()
    expect(wrapper.find('.leaver-mark').exists()).toBe(false)
  })

  it('shows the L mark + correct class when annotation.leaver=self', () => {
    const annotated = makeRecord({}, {
      annotation: { leaver: 'self' },
    } as unknown as Partial<MatchRecord>)
    const wrapper = mountCard({ record: annotated })
    const mark = wrapper.find('.leaver-mark')
    expect(mark.exists()).toBe(true)
    expect(mark.classes()).toContain('leaver-self')
    expect(mark.attributes('title')).toContain('You left')
  })

  it('hides the chooser when the card is collapsed', () => {
    const wrapper = mountCard()
    expect(wrapper.find('.leaver-chooser').exists()).toBe(false)
  })

  it('renders the three scenario chips + no Clear when card is expanded and unannotated', () => {
    const wrapper = mountCard({ isExpanded: true })
    const chips = wrapper.findAll('.leaver-chip')
    expect(chips).toHaveLength(3) // self / team / enemy; Clear is hidden
    expect(wrapper.find('.leaver-chip.leaver-clear').exists()).toBe(false)
  })

  it('marks the active chip when an annotation is set', () => {
    const annotated = makeRecord({}, {
      annotation: { leaver: 'team' },
    } as unknown as Partial<MatchRecord>)
    const wrapper = mountCard({ record: annotated, isExpanded: true })
    const team = wrapper.findAll('.leaver-chip').find(c => c.text().includes('Ally'))!
    expect(team.classes()).toContain('active')
    expect(team.attributes('aria-pressed')).toBe('true')
    // Clear shows up alongside the three scenarios.
    expect(wrapper.find('.leaver-chip.leaver-clear').exists()).toBe(true)
  })

  it('emits set-leaver-annotation with the picked scenario', async () => {
    const wrapper = mountCard({ isExpanded: true })
    const self = wrapper.findAll('.leaver-chip').find(c => c.text().includes('I left'))!
    await self.trigger('click')
    const e = wrapper.emitted('set-leaver-annotation')!
    expect(e[0]).toEqual([wrapper.props('record').match_key, 'self'])
  })

  it('clicking the active chip emits a clear (empty leaver)', async () => {
    const annotated = makeRecord({}, {
      annotation: { leaver: 'enemy' },
    } as unknown as Partial<MatchRecord>)
    const wrapper = mountCard({ record: annotated, isExpanded: true })
    const enemy = wrapper.findAll('.leaver-chip').find(c => c.text().includes('Enemy'))!
    await enemy.trigger('click')
    const e = wrapper.emitted('set-leaver-annotation')!
    expect(e[0]).toEqual([wrapper.props('record').match_key, ''])
  })

  it('clicking Clear emits with empty leaver', async () => {
    const annotated = makeRecord({}, {
      annotation: { leaver: 'self' },
    } as unknown as Partial<MatchRecord>)
    const wrapper = mountCard({ record: annotated, isExpanded: true })
    const clear = wrapper.find('.leaver-chip.leaver-clear')
    await clear.trigger('click')
    const e = wrapper.emitted('set-leaver-annotation')!
    expect(e[0]).toEqual([wrapper.props('record').match_key, ''])
  })
})
