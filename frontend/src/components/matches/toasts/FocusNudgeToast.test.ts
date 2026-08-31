import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/vue'
import FocusNudgeToast from '@/components/matches/toasts/FocusNudgeToast.vue'
import type { FocusEntry } from '@/api'

const entry = (over: Partial<FocusEntry> = {}): FocusEntry => ({
  item_id: 'f-1',
  text: 'Hold the high ground',
  source: 'self',
  coach_name: '',
  ...over,
} as FocusEntry)

const renderToast = (items: FocusEntry[] = [entry()], visible = true) =>
  render(FocusNudgeToast, { props: { items, visible } })

describe('FocusNudgeToast', () => {
  it('says what to work on while there is still a session to do it in', () => {
    renderToast()
    expect(screen.getByRole('status', { name: 'What to focus on this session' })).toBeInTheDocument()
    expect(screen.getByText('Hold the high ground')).toBeInTheDocument()
  })

  it('stays down when it is not wanted', () => {
    renderToast([entry()], false)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it("attributes a coach's item to the coach", () => {
    renderToast([entry({ source: 'coach', coach_name: 'Ordo' })])
    expect(screen.getByText('— Ordo')).toBeInTheDocument()
  })

  it('falls back to "your coach" when the archive named nobody', () => {
    renderToast([entry({ source: 'coach', coach_name: '' })])
    expect(screen.getByText('— your coach')).toBeInTheDocument()
  })

  it('does not sign an item the player wrote themselves', () => {
    renderToast([entry({ source: 'self' })])
    expect(screen.queryByText(/^—/)).not.toBeInTheDocument()
  })

  it('renders emphasis a coach wrote, rather than literal asterisks', () => {
    // Focus items take the same grammar as every other thing a person writes.
    renderToast([entry({ text: '**stop** dying on the flank' })])
    expect(screen.getByText('stop')).toBeInTheDocument()
    expect(screen.queryByText(/\*\*stop\*\*/)).not.toBeInTheDocument()
  })

  it('can be closed, because advice you dismiss is a decision', async () => {
    const { emitted } = renderToast()
    await fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(emitted('dismiss')).toHaveLength(1)
  })

  it('renders every item it was given', () => {
    renderToast([entry(), entry({ item_id: 'f-2', text: 'Use cooldowns earlier' })])
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})
