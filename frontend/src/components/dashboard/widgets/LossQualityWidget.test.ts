import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/vue'
import LossQualityWidget from '@/components/dashboard/widgets/LossQualityWidget.vue'
import { renderWidget } from '@/test-utils'

const ROWS = [
  { key: 'close',  total: 6, winrate: 0, share: 50 },
  { key: 'normal', total: 4, winrate: 0, share: 33 },
  { key: 'stomp',  total: 2, winrate: 0, share: 17 },
]

describe('LossQualityWidget', () => {
  it('buckets defeats by margin, with the sample and share on each row', () => {
    renderWidget(LossQualityWidget, { dossier: { lossQualityBreakdown: { rows: ROWS, unscored: 0 } } })
    expect(screen.getByText('Loss quality')).toBeInTheDocument()
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]!).getByText('close')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('6x')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('50%')).toBeInTheDocument()
  })

  it('puts each share in the meter, not only in the bar width', () => {
    renderWidget(LossQualityWidget, { dossier: { lossQualityBreakdown: { rows: ROWS, unscored: 0 } } })
    expect(screen.getByRole('progressbar', { name: 'close share' })).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getByRole('progressbar', { name: 'stomp share' })).toHaveAttribute('aria-valuenow', '17')
  })

  it('accounts for losses whose score never parsed', () => {
    renderWidget(LossQualityWidget, { dossier: { lossQualityBreakdown: { rows: ROWS, unscored: 3 } } })
    expect(screen.getByText('3 losses without a readable score')).toBeInTheDocument()
  })

  it('says "loss" when exactly one went unscored', () => {
    renderWidget(LossQualityWidget, { dossier: { lossQualityBreakdown: { rows: ROWS, unscored: 1 } } })
    expect(screen.getByText('1 loss without a readable score')).toBeInTheDocument()
  })

  it('stays silent about unscored losses when there are none', () => {
    renderWidget(LossQualityWidget, { dossier: { lossQualityBreakdown: { rows: ROWS, unscored: 0 } } })
    expect(screen.queryByText(/without a readable score/)).not.toBeInTheDocument()
  })

  it('says there were no defeats rather than printing three zeroes', () => {
    // The helper always returns all three buckets, so a set with nothing lost
    // still arrives as close/normal/stomp at 0. Printing "0x · 0%" three times
    // is the blank-is-not-zero trap: it reads as measured, not as absent.
    const empty = (['close', 'normal', 'stomp'] as const).map((key) => ({ key, total: 0, winrate: 0, share: 0 }))
    renderWidget(LossQualityWidget, { dossier: { lossQualityBreakdown: { rows: empty, unscored: 0 } } })
    expect(screen.getByText('No defeats in this set.')).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('still shows the buckets when only some are empty', () => {
    const rows = [
      { key: 'close', total: 3, winrate: 0, share: 100 },
      { key: 'normal', total: 0, winrate: 0, share: 0 },
      { key: 'stomp', total: 0, winrate: 0, share: 0 },
    ]
    renderWidget(LossQualityWidget, { dossier: { lossQualityBreakdown: { rows, unscored: 0 } } })
    expect(screen.queryByText('No defeats in this set.')).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('does not claim there were no defeats when they were merely unscored', () => {
    // Losses whose score never parsed are still losses. Saying "no defeats"
    // here would contradict the line right below it.
    const empty = (['close', 'normal', 'stomp'] as const).map((key) => ({ key, total: 0, winrate: 0, share: 0 }))
    renderWidget(LossQualityWidget, { dossier: { lossQualityBreakdown: { rows: empty, unscored: 2 } } })
    expect(screen.queryByText('No defeats in this set.')).not.toBeInTheDocument()
    expect(screen.getByText('2 losses without a readable score')).toBeInTheDocument()
  })
})
