import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'

import type { MatchRecord } from '@/api'
import SessionBanner from '@/components/matches/session/SessionBanner.vue'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'

// The rail says two things nothing else says together: the rank the player is
// on, and what the running session has done to it. Its render branches are
// about being HONEST when one of those is missing.

let seq = 0
interface Bits {
  minutesAgo: number
  result?: string
  role?: string
  rank?: { tier: string; level: number; progress?: number }
  change?: number
}

function rec({ minutesAgo, result = 'victory', role = 'support', rank, change }: Bits): MatchRecord {
  seq++
  const when = new Date(Date.now() - minutesAgo * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    match_key: `m${seq}`,
    queue_type: 'role',
    data: {
      playlist: 'competitive', map: 'rialto', hero: 'lucio', role, result,
      date: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`,
      finished_at: `${pad(when.getHours())}:${pad(when.getMinutes())}`,
      ...(rank ? { rank: rank.tier, level: rank.level, rank_progress: rank.progress } : {}),
      ...(change === undefined ? {} : { change_percent: change }),
    },
  } as unknown as MatchRecord
}

let pinia: Pinia

function mount(records: MatchRecord[]) {
  seq = 0
  pinia = createPinia()
  setActivePinia(pinia)
  seedQuery(qk.matches, records)
  return render(SessionBanner, { global: { plugins: [pinia] } })
}

afterEach(async () => {
  await vi.dynamicImportSettled()
})

beforeEach(() => { seq = 0 })

describe('SessionBanner', () => {
  it('renders nothing when the newest match is older than the session gap', () => {
    mount([rec({ minutesAgo: 60 * 24 })])
    expect(screen.queryByRole('status', { name: 'Live session' })).not.toBeInTheDocument()
  })

  it('leads with the rank and follows with what the session did to it', () => {
    mount([
      rec({ minutesAgo: 90, rank: { tier: 'gold', level: 3, progress: 80 }, change: 22 }),
      rec({ minutesAgo: 50, rank: { tier: 'gold', level: 2, progress: 20 }, change: 21 }),
      rec({ minutesAgo: 10, result: 'defeat', rank: { tier: 'gold', level: 2, progress: 55 }, change: -20 }),
    ])
    const banner = screen.getByRole('status', { name: 'Live session' })
    expect(banner).toHaveTextContent('Gold 2')
    expect(banner).toHaveTextContent('55%')
    expect(banner).toHaveTextContent('3 games')
    expect(banner).toHaveTextContent('2W-1L')
  })

  it('says the rank is unread rather than inventing one', () => {
    mount([rec({ minutesAgo: 20 }), rec({ minutesAgo: 10, result: 'defeat' })])
    expect(screen.getByText('No rank read')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Live session' })).toHaveTextContent('2 games')
  })

  it('leaves the movement out entirely when no capture in the session reported one', () => {
    mount([
      rec({ minutesAgo: 20, rank: { tier: 'gold', level: 2, progress: 40 } }),
      rec({ minutesAgo: 10, result: 'defeat', rank: { tier: 'gold', level: 2, progress: 20 } }),
    ])
    // A session whose pills went unread has an UNKNOWN movement, not 0%.
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })

  it('names the movement in words as well as color, and flags a partial read', () => {
    mount([
      rec({ minutesAgo: 30, rank: { tier: 'gold', level: 2, progress: 20 }, change: 22 }),
      rec({ minutesAgo: 20 }),
      rec({ minutesAgo: 10, result: 'defeat' }),
    ])
    expect(screen.getByRole('img', { name: /\+22% rank this session — /i })).toBeInTheDocument()
    expect(screen.getByText('(1/3 read)')).toBeInTheDocument()
  })

  it('speaks in the singular for a one-game session', () => {
    mount([rec({ minutesAgo: 10 })])
    expect(screen.getByRole('status', { name: 'Live session' })).toHaveTextContent('1 game ·')
  })

  it('goes quiet once the session it is narrating has gone stale', async () => {
    // The rail is read off the wall clock, not off the records, and a player
    // who stops playing and leaves the app open is exactly when the records
    // stop changing. It said "Live" all night.
    vi.useFakeTimers()
    try {
      mount([rec({ minutesAgo: 10 }), rec({ minutesAgo: 5, result: 'defeat' })])
      expect(screen.getByRole('status', { name: 'Live session' })).toBeInTheDocument()

      // Past the session gap from the newest match.
      await vi.advanceTimersByTimeAsync(4 * 60 * 60_000)
      expect(screen.queryByRole('status', { name: 'Live session' })).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays dismissed once the player closes it', async () => {
    mount([rec({ minutesAgo: 10 }), rec({ minutesAgo: 5, result: 'defeat' })])
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss live session' }))
    expect(screen.queryByRole('status', { name: 'Live session' })).not.toBeInTheDocument()
  })
})
