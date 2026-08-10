import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import ParseProgressPanel from '@/components/ingest/ParseProgressPanel.vue'
import type { ParseProgressEvent } from '@/components/ingest/parse-progress'

function progress(over: Partial<ParseProgressEvent> = {}): ParseProgressEvent {
  return {
    done: 1,
    total: 5,
    filename: 'sample.png',
    screenshot_type: 'summary',
    ...over,
  }
}

interface PanelProps {
  parseBusy: boolean
  parseProgress: ParseProgressEvent | null
  parseLog: ParseProgressEvent[]
  isOpen: boolean
}

function renderPanel(props: PanelProps) {
  return render(ParseProgressPanel, { props })
}

describe('ParseProgressPanel', () => {
  it('renders nothing when loading=false', () => {
    renderPanel({ parseBusy: false, parseProgress: null, parseLog: [], isOpen: false })
    expect(screen.queryByText('Parsing')).not.toBeInTheDocument()
  })

  it('renders the panel when loading=true', () => {
    renderPanel({ parseBusy: true, parseProgress: null, parseLog: [], isOpen: false })
    expect(screen.getByText('Parsing')).toBeInTheDocument()
  })

  it('shows 0/… counter while progress is null', () => {
    renderPanel({ parseBusy: true, parseProgress: null, parseLog: [], isOpen: false })
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('…')).toBeInTheDocument()
  })

  it('renders done/total from parseProgress', () => {
    renderPanel({
      parseBusy: true,
      parseProgress: progress({ done: 3, total: 7 }),
      parseLog: [],
      isOpen: false,
    })
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('reports progress through the progressbar value attributes', () => {
    renderPanel({
      parseBusy: true,
      parseProgress: progress({ done: 2, total: 5 }),
      parseLog: [],
      isOpen: false,
    })
    const meter = screen.getByRole('progressbar', { name: 'Parse progress' })
    expect(meter).toHaveAttribute('aria-valuemin', '0')
    expect(meter).toHaveAttribute('aria-valuemax', '5')
    expect(meter).toHaveAttribute('aria-valuenow', '2')
  })

  it('is an indeterminate progressbar until a total arrives', () => {
    renderPanel({
      parseBusy: true,
      parseProgress: progress({ done: 0, total: 0 }),
      parseLog: [],
      isOpen: false,
    })
    // No total means no known range: an indeterminate progressbar omits
    // both bounds rather than claiming a max of 0 / a value of 0.
    const meter = screen.getByRole('progressbar', { name: 'Parse progress' })
    expect(meter).not.toHaveAttribute('aria-valuenow')
    expect(meter).not.toHaveAttribute('aria-valuemax')
    expect(meter).toHaveAttribute('aria-valuemin', '0')
  })

  it('does not render the expanded details when isOpen=false', () => {
    renderPanel({
      parseBusy: true,
      parseProgress: progress(),
      parseLog: [],
      isOpen: false,
    })
    expect(screen.queryByText('sample.png')).not.toBeInTheDocument()
  })

  it('renders the current-file detail row when isOpen=true', () => {
    renderPanel({
      parseBusy: true,
      parseProgress: progress({ filename: 'overwatch.png', screenshot_type: 'summary' }),
      parseLog: [],
      isOpen: true,
    })
    expect(screen.getByText('overwatch.png')).toBeInTheDocument()
    expect(screen.getByText('SUMMARY')).toBeInTheDocument()
  })

  it('summary-type renders map / result / date / length fields when present', () => {
    renderPanel({
      parseBusy: true,
      parseProgress: progress({
        screenshot_type: 'summary',
        data: { map: 'rialto', result: 'victory', date: '2026-05-10', game_length: '11:25' },
      }),
      parseLog: [],
      isOpen: true,
    })
    expect(screen.getByText(/rialto/)).toBeInTheDocument()
    expect(screen.getByText(/victory/)).toBeInTheDocument()
    expect(screen.getByText(/2026-05-10/)).toBeInTheDocument()
    expect(screen.getByText(/11:25/)).toBeInTheDocument()
  })

  it('scoreboard-type renders the E/A/D + damage triple', () => {
    renderPanel({
      parseBusy: true,
      parseProgress: progress({
        screenshot_type: 'teams',
        data: { eliminations: 17, assists: 16, deaths: 11, damage: 7200 },
      }),
      parseLog: [],
      isOpen: true,
    })
    expect(screen.getByText(/17/)).toBeInTheDocument()
    expect(screen.getByText(/16/)).toBeInTheDocument()
    expect(screen.getByText(/11/)).toBeInTheDocument()
    expect(screen.getByText(/7,200/)).toBeInTheDocument() // toLocaleString puts in the comma
  })

  it('clicking the summary row emits toggle-open', async () => {
    const user = userEvent.setup()
    const { emitted } = renderPanel({ parseBusy: true, parseProgress: null, parseLog: [], isOpen: false })
    await user.click(screen.getByText('Parsing'))
    expect(emitted('toggle-open')).toBeTruthy()
  })

  it('chevron carries the .open class when isOpen=true', () => {
    const { baseElement } = renderPanel({ parseBusy: true, parseProgress: null, parseLog: [], isOpen: true })
    // The chevron is a decorative aria-hidden glyph; its rotation class
    // is the only expression of the open state.
    // eslint-disable-next-line testing-library/no-node-access, no-restricted-syntax -- decorative aria-hidden chevron; rotation class is the only open-state signal
    expect(baseElement.querySelector('.pp-chev')).toHaveClass('open')
  })

  it('chevron drops the .open class when isOpen=false', () => {
    const { baseElement } = renderPanel({ parseBusy: true, parseProgress: null, parseLog: [], isOpen: false })
    // eslint-disable-next-line testing-library/no-node-access, no-restricted-syntax -- decorative aria-hidden chevron; rotation class is the only open-state signal
    expect(baseElement.querySelector('.pp-chev')).not.toHaveClass('open')
  })
})
