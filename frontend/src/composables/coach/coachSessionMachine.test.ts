import { describe, expect, it } from 'vitest'

import { stepCoachSession, type CoachSessionEvent, type CoachSessionState } from '@/composables/coach/coachSessionMachine'

// The coach's session on the client, driven through its one transition
// function. Every refusal leaves the state as it was.

function run(events: CoachSessionEvent[], from: CoachSessionState = { status: 'none' }) {
  let state = from
  const refused: string[] = []
  for (const event of events) {
    const step = stepCoachSession(state, event)
    if (step.ok) state = step.state
    else refused.push(event.type)
  }
  return { state, refused }
}

describe('stepCoachSession', () => {
  it('opens, arms End, disarms, and ends', () => {
    expect(run([{ type: 'session-opened' }, { type: 'arm-end' }]).state.status).toBe('endArmed')
    expect(run([{ type: 'session-opened' }, { type: 'arm-end' }, { type: 'disarm-end' }]).state.status).toBe('open')
    expect(run([{ type: 'session-opened' }, { type: 'arm-end' }, { type: 'end' }]).state.status).toBe('ending')
  })

  // A second End while the first is running is exactly the double-click.
  it('refuses a second end, and every move but the close, while ending', () => {
    const { state, refused } = run([
      { type: 'session-opened' }, { type: 'end' }, { type: 'end' }, { type: 'arm-end' }, { type: 'disarm-end' },
    ])
    expect(state.status).toBe('ending')
    expect(refused).toEqual(['end', 'arm-end', 'disarm-end'])
    expect(run([{ type: 'session-closed' }], state).state.status).toBe('none')
  })

  it('has nothing to arm or end without a session', () => {
    const { state, refused } = run([{ type: 'arm-end' }, { type: 'end' }])
    expect(state.status).toBe('none')
    expect(refused).toEqual(['arm-end', 'end'])
  })

  // An arming never outlives its session.
  it('drops an armed End when the session closes underneath it', () => {
    expect(run([{ type: 'session-opened' }, { type: 'arm-end' }, { type: 'session-closed' }]).state.status).toBe('none')
  })
})
