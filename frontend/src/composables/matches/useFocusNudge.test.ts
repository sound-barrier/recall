import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import type { FocusEntry } from '@/api'
import { setApiBacking } from '@/api-client'
import { useFocusNudge } from '@/composables/matches/useFocusNudge'
import type { SessionSummary } from '@/match/dossier/match-momentum-helpers'
import { getQueryClient, resetQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'

// endsAt is an absolute instant and the nudge arms its expiry off it, so a
// live fixture has to end in the future the way a real session does.
function session(startedAt: number, endsIn = 3 * 60 * 60_000): SessionSummary {
  return {
    matches: 3, w: 2, l: 1, d: 0, netPercent: 18, readCount: 3,
    startedAt, endsAt: Date.now() + endsIn,
  }
}

function entry(over: Partial<FocusEntry> = {}): FocusEntry {
  return { item_id: 'i', text: 't', status: 'working', source: 'self', from: '2026-08-18', ...over }
}

const FOUR = [
  entry({ item_id: '1', source: 'coach', status: 'new' }),
  entry({ item_id: '2', source: 'coach' }),
  entry({ item_id: '3' }),
  entry({ item_id: '4' }),
]

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
}

describe('useFocusNudge', () => {
  beforeEach(() => {
    resetQueryClient()
    setApiBacking({ ListFocus: vi.fn(async () => FOUR) })
  })

  it('says nothing when no session is live', async () => {
    const nudge = useFocusNudge(ref(null))
    await settle()
    expect(nudge.visible.value).toBe(false)
    expect(nudge.items.value).toEqual([])
  })

  it('says the top three once a session is live', async () => {
    getQueryClient().setQueryData(qk.focus, FOUR)
    const nudge = useFocusNudge(ref(session(100)))
    await settle()
    expect(nudge.visible.value).toBe(true)
    expect(nudge.items.value.map((e) => e.item_id)).toEqual(['1', '2', '3'])
  })

  it('says nothing when the list is empty', async () => {
    getQueryClient().setQueryData(qk.focus, [])
    const nudge = useFocusNudge(ref(session(100)))
    await settle()
    expect(nudge.visible.value).toBe(false)
  })

  it('stays dismissed for the session it was dismissed in', async () => {
    getQueryClient().setQueryData(qk.focus, FOUR)
    const live = ref<SessionSummary | null>(session(100))
    const nudge = useFocusNudge(live)
    await settle()

    nudge.dismiss()
    expect(nudge.visible.value).toBe(false)

    // A later parse in the SAME session must not bring it back.
    live.value = session(100)
    expect(nudge.visible.value).toBe(false)
  })

  it('speaks again for a new session', async () => {
    getQueryClient().setQueryData(qk.focus, FOUR)
    const live = ref<SessionSummary | null>(session(100))
    const nudge = useFocusNudge(live)
    await settle()
    nudge.dismiss()

    live.value = session(999)
    expect(nudge.visible.value).toBe(true)
  })
})

describe('useFocusNudge — the session ending', () => {
  beforeEach(() => {
    resetQueryClient()
    setApiBacking({ ListFocus: vi.fn(async () => FOUR) })
  })

  // "This session" said about a session that ended hours ago is a lie the
  // player wakes up to: Recall lives in the tray, so nothing else would
  // ever have taken it off the screen.
  it('says nothing once the session it was raised for has ended', async () => {
    getQueryClient().setQueryData(qk.focus, FOUR)
    const nudge = useFocusNudge(ref(session(100, -1)))
    await settle()
    expect(nudge.visible.value).toBe(false)
  })

  it('speaks while the session is still live', async () => {
    getQueryClient().setQueryData(qk.focus, FOUR)
    const nudge = useFocusNudge(ref(session(100)))
    await settle()
    expect(nudge.visible.value).toBe(true)
  })

  // A caller that dismisses every toast at once must not silence a session
  // whose list simply had not arrived yet.
  it('ignores a dismiss it was not on screen for', async () => {
    getQueryClient().setQueryData(qk.focus, [])
    const live = ref<SessionSummary | null>(session(100))
    const nudge = useFocusNudge(live)
    await settle()
    nudge.dismiss()

    getQueryClient().setQueryData(qk.focus, FOUR)
    await settle()
    expect(nudge.visible.value).toBe(true)
  })
})
