import { render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'

import CoachOrphanNotes from '@/components/coach/room/CoachOrphanNotes.vue'

// The drawer for notes the session carries but cannot frame. The match KEY
// is the label — the coach's store keeps only notes, never the loaned
// matches — so a dated capture key reads as its day and a replay key as
// its code.

const NOTES = [
  { matchKey: 'match-2026-05-02T21-15-00', kind: 'note', text: 'The pattern again.' },
  { matchKey: 'replay-Z9Y8X7', kind: 'reviewed_only', text: '' },
]

describe('CoachOrphanNotes', () => {
  it('labels rows by day or code, and speaks the reviewed-only mark', () => {
    render(CoachOrphanNotes, { props: { notes: NOTES, heading: 'Earlier notes about Sable' } })
    expect(screen.getByText('Earlier notes about Sable')).toBeInTheDocument()
    expect(screen.getByText('2 from before this corpus')).toBeInTheDocument()
    expect(screen.getByText(/May 2/)).toBeInTheDocument()
    expect(screen.getByText('Z9Y8X7')).toBeInTheDocument()
    expect(screen.getByText('Reviewed — nothing to add.')).toBeInTheDocument()
  })

  it('renders nothing at all when every note has a frame', () => {
    render(CoachOrphanNotes, { props: { notes: [], heading: 'Earlier notes about Sable' } })
    expect(screen.queryByText('Earlier notes about Sable')).toBeNull()
    expect(screen.queryByText(/from before this corpus/)).toBeNull()
  })
})
