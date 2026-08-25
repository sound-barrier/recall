import { render, screen, fireEvent } from '@testing-library/vue'
import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api-client'
import CoachObservedContext from '@/components/coach/room/CoachObservedContext.vue'

// What the coach saw, for a match the app has never seen. A replay frame
// arrives blank — no screenshot, nothing parsed from one — so without this
// the card reads "No result · Not dated · —" forever.
function recordOf(over: Partial<MatchRecord['data']> = {}): MatchRecord {
  return {
    match_key: 'replay-A1B2C3',
    source_files: [],
    source: 'replay',
    data: { ...over },
    annotation: { leavers: [], throwers: [], replay_code: 'A1B2C3' },
  } as MatchRecord
}

function renderContext(record = recordOf(), sessionDate = '2026-08-15') {
  return render(CoachObservedContext, { props: { record, sessionDate } })
}

/** The most recent context the editor reported. `emitted()` is `unknown[][]`. */
function lastContext(view: ReturnType<typeof renderContext>): Record<string, unknown> {
  const emitted = view.emitted('update') as unknown[][] | undefined
  expect(emitted, 'the editor reported nothing').toBeTruthy()
  return emitted!.at(-1)![0] as Record<string, unknown>
}

describe('CoachObservedContext', () => {
  it('names the replay it is asking about', () => {
    renderContext()
    expect(screen.getByRole('region', { name: /what you saw in A1B2C3/i })).toBeInTheDocument()
  })

  // The date is pre-filled rather than blank, and that is load-bearing: a
  // match with no time at all passes EVERY date filter, so a dateless
  // coach-created match would turn up in every season on the player's side.
  it('fills the date in rather than leaving a match undated', () => {
    renderContext()
    expect(screen.getByLabelText('Date')).toHaveValue('2026-08-15')
  })

  it('shows what the coach already recorded rather than asking twice', () => {
    renderContext(recordOf({ map: 'ilios', hero: 'ana', result: 'victory', date: '2026-08-01' }))
    expect(screen.getByLabelText('Map')).toHaveValue('ilios')
    expect(screen.getByLabelText('Hero')).toHaveValue('ana')
    expect(screen.getByLabelText('Result')).toHaveValue('victory')
    expect(screen.getByLabelText('Date')).toHaveValue('2026-08-01')
  })

  // Commits ride change/blur, never keystrokes — an @input commit fed the
  // autosave debounce mid-word and shipped "Ilio" to the server.
  it('reports what the coach observed once they leave the field', async () => {
    const view = renderContext()
    await fireEvent.update(screen.getByLabelText('Map'), 'Ilios')
    expect(view.emitted('update')).toBeUndefined()
    await fireEvent.change(screen.getByLabelText('Map'))
    expect(lastContext(view).map).toBe('Ilios')
  })

  // "Not sure" is absence, not an empty result — the wire has no empty
  // member because an empty result is not a result. Only omission is free.
  it('omits the result entirely when the coach did not see one', async () => {
    const view = renderContext(recordOf({ result: 'victory' }))
    await fireEvent.update(screen.getByLabelText('Result'), '')
    expect('result' in lastContext(view)).toBe(false)
  })

  it('re-reads itself when the coach moves to another frame', async () => {
    const view = renderContext(recordOf({ map: 'ilios' }))
    expect(screen.getByLabelText('Map')).toHaveValue('ilios')

    await view.rerender({
      record: { ...recordOf({ map: 'numbani' }), match_key: 'replay-D4E5F6' },
      sessionDate: '2026-08-15',
    })
    expect(screen.getByLabelText('Map')).toHaveValue('numbani')
  })
})

// A team watched the replay together — there is no single hero to name,
// and asking for one would invite inventing data about somebody.
describe('CoachObservedContext — team lens', () => {
  it('drops the hero field and keeps map, result and date', () => {
    render(CoachObservedContext, {
      props: { record: recordOf(), sessionDate: '2026-08-15', subjectKind: 'team' },
    })
    expect(screen.queryByLabelText('Hero')).toBeNull()
    expect(screen.getByLabelText('Map')).toBeInTheDocument()
    expect(screen.getByLabelText('Result')).toBeInTheDocument()
    expect(screen.getByLabelText('Date')).toBeInTheDocument()
  })
})

