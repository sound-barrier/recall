// The coach's session as the CLIENT holds it: whether one is open, and
// where its End stands. The session itself is server truth (vue-query);
// this union holds only what the client knows that the server does not —
// that End was armed, and that an end is already under way.
//
// Two separate refs used to carry this (`endArmed` plus nothing for
// "ending"), so a double-click on End ran the whole end twice, and the
// arming could survive into a session that no longer existed.

export type CoachSessionState =
  | { status: 'none' }
  | { status: 'open' }
  /** End asked once more because the notes are not exported yet. */
  | { status: 'endArmed' }
  /** The end is running; nothing may start it again. */
  | { status: 'ending' }

export type CoachSessionEvent =
  | { type: 'session-opened' }
  | { type: 'session-closed' }
  | { type: 'arm-end' }
  | { type: 'disarm-end' }
  | { type: 'end' }

export type CoachSessionStep =
  | { ok: true; state: CoachSessionState }
  | { ok: false; reason: 'illegal' }

const illegal: CoachSessionStep = { ok: false, reason: 'illegal' }
const to = (status: CoachSessionState['status']): CoachSessionStep => ({ ok: true, state: { status } })

function stepOpen(event: CoachSessionEvent): CoachSessionStep {
  switch (event.type) {
    case 'arm-end': return to('endArmed')
    case 'end': return to('ending')
    case 'session-closed': return to('none')
    case 'session-opened':
    case 'disarm-end': return illegal
  }
}

function stepEndArmed(event: CoachSessionEvent): CoachSessionStep {
  switch (event.type) {
    case 'disarm-end': return to('open')
    case 'end': return to('ending')
    case 'session-closed': return to('none')
    case 'session-opened':
    case 'arm-end': return illegal
  }
}

/** The one transition function: the next state, or a refusal that changes nothing. */
export function stepCoachSession(state: CoachSessionState, event: CoachSessionEvent): CoachSessionStep {
  switch (state.status) {
    case 'none': return event.type === 'session-opened' ? to('open') : illegal
    case 'open': return stepOpen(event)
    case 'endArmed': return stepEndArmed(event)
    case 'ending': return event.type === 'session-closed' ? to('none') : illegal
  }
}
