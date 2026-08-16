import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import type { CoachReturnItem, CoachReturnSheet } from '@/api-client'
import { isOrphan, useCoachReturnDecisions } from '@/composables/coach/useCoachReturnDecisions'

function note(over: Partial<CoachReturnItem> = {}): CoachReturnItem {
  return {
    note_id: 'n1',
    match_key: 'match-2026-08-10T21-14-00',
    kind: 'note',
    text: 'Late peel on B.',
    focus_tags: [],
    extra_tags: [],
    match_clock: '',
    updated_at: '2026-08-14T19:02:00Z',
    status: 'pending',
    ...over,
  }
}

function sheet(over: Partial<CoachReturnSheet> = {}): CoachReturnSheet {
  return {
    id: 7,
    coach_name: 'Ordo',
    player_handle: 'Sable',
    session_date: '2026-08-14',
    imported_at: '2026-08-15T09:12:00Z',
    summary: 'Ult economy first.',
    notes: [note({ note_id: 'n1' }), note({ note_id: 'n2' }), note({ note_id: 'n3' })],
    decisions: {},
    pending: 3,
    player_mismatch: false,
    ...over,
  }
}

describe('useCoachReturnDecisions', () => {
  it('starts from the sheet\'s saved decisions', () => {
    const api = useCoachReturnDecisions(sheet({ decisions: { n1: 'accepted', n2: 'skipped' } }))
    expect(api.verdictOf('n1')).toBe('accepted')
    expect(api.verdictOf('n2')).toBe('skipped')
    expect(api.verdictOf('n3')).toBe('')
    expect(api.acceptedCount.value).toBe(1)
    expect(api.dirty.value).toBe(false)
  })

  it('records one verdict at a time and counts what Finish would save', () => {
    const s = sheet()
    const api = useCoachReturnDecisions(s)
    api.decide(s.notes[0]!, 'accepted')
    api.decide(s.notes[1]!, 'skipped')
    expect(api.acceptedCount.value).toBe(1)
    expect(api.dirty.value).toBe(true)
    expect(api.body.value).toEqual({ n1: 'accepted', n2: 'skipped' })
  })

  it('omits undecided notes from the body — the PUT is partial', () => {
    const s = sheet()
    const api = useCoachReturnDecisions(s)
    api.decide(s.notes[2]!, 'skipped')
    expect(api.body.value).toEqual({ n3: 'skipped' })
  })

  it('accept all / skip all sweep every note', () => {
    const s = sheet()
    const api = useCoachReturnDecisions(s)
    api.acceptAll()
    expect(api.body.value).toEqual({ n1: 'accepted', n2: 'accepted', n3: 'accepted' })
    expect(api.acceptedCount.value).toBe(3)
    api.skipAll()
    expect(api.acceptedCount.value).toBe(0)
  })

  it('refuses to accept an orphan — its match is not in this history', () => {
    const orphan = note({ note_id: 'n2', status: 'orphan' })
    const s = sheet({ notes: [note({ note_id: 'n1' }), orphan] })
    const api = useCoachReturnDecisions(s)
    expect(isOrphan(orphan)).toBe(true)

    api.decide(orphan, 'accepted')
    expect(api.verdictOf('n2')).toBe('')

    api.acceptAll()
    expect(api.body.value).toEqual({ n1: 'accepted' })

    // Skipping an orphan is still allowed — that is how it stops nagging.
    api.decide(orphan, 'skipped')
    expect(api.verdictOf('n2')).toBe('skipped')
  })

  it('stays clean when a verdict is re-applied unchanged', () => {
    const s = sheet({ decisions: { n1: 'accepted' } })
    const api = useCoachReturnDecisions(s)
    api.decide(s.notes[0]!, 'accepted')
    expect(api.dirty.value).toBe(false)
    api.decide(s.notes[0]!, 'skipped')
    expect(api.dirty.value).toBe(true)
  })

  it('reseeds when a different sheet opens — no verdict leaks between coaches', () => {
    const current = ref<CoachReturnSheet | null>(sheet({ id: 7 }))
    const api = useCoachReturnDecisions(current)
    api.acceptAll()
    expect(api.acceptedCount.value).toBe(3)

    current.value = sheet({ id: 9, decisions: { n1: 'skipped' } })
    expect(api.verdictOf('n1')).toBe('skipped')
    expect(api.acceptedCount.value).toBe(0)
    expect(api.dirty.value).toBe(false)
  })

  it('handles a closed dialog (null sheet) without throwing', () => {
    const api = useCoachReturnDecisions(ref(null))
    api.acceptAll()
    expect(api.body.value).toEqual({})
    expect(api.acceptedCount.value).toBe(0)
    expect(api.dirty.value).toBe(false)
  })
})
