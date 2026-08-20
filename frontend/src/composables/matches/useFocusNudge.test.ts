import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import type { FocusEntry } from '@/api'
import { setApiBacking } from '@/api-client'
import { useFocusNudge } from '@/composables/matches/useFocusNudge'
import type { SessionSummary } from '@/match/dossier/match-momentum-helpers'
import { getQueryClient, resetQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'

function session(startedAt: number): SessionSummary {
  return { matches: 3, w: 2, l: 1, d: 0, netPercent: 18, readCount: 3, startedAt, endsAt: startedAt + 1 }
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
