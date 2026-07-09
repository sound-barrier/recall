import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'

import type { MatchRecord } from '@/api-client'
import type { NarrowApi } from '@/composables/matches/useNarrow'
import { mountWidget } from '@/test-utils/mountWidget'

// Stub reference data so hero→role is deterministic (no fetch, no singleton
// cross-test state).
vi.mock('@/composables/shared/useOWData', () => {
  const role: Record<string, string> = { reinhardt: 'tank', tracer: 'dps', lucio: 'support', ana: 'support', zarya: 'tank', junkrat: 'dps' }
  return { useOWData: () => ({ heroRole: (h?: string | null) => role[h ?? ''] ?? '', heroDisplayName: (h: string) => h }) }
})

const { default: MatchHeroPoolBand } = await import('@/components/matches/dossier/MatchHeroPoolBand.vue')

let seq = 0
function rec(o: { hero: string; role?: string; result?: string; queue?: 'role' | 'open'; mode?: string }): MatchRecord {
  seq++
  return {
    match_key: `m${seq}`, queue_type: o.queue ?? 'role', play_mode: o.mode ?? 'competitive',
    data: { result: o.result ?? 'victory', role: o.role, hero: o.hero,
      heroes_played: [{ hero: o.hero, percent_played: 100 }] },
  } as unknown as MatchRecord
}
function games(n: number, wins: number, o: Parameters<typeof rec>[0]) {
  return Array.from({ length: n }, (_, i) => rec({ ...o, result: i < wins ? 'victory' : 'defeat' }))
}
function corpus(): MatchRecord[] {
  seq = 0
  return [
    ...games(8, 5, { hero: 'reinhardt', role: 'tank', queue: 'role' }),
    ...games(8, 6, { hero: 'lucio', role: 'support', queue: 'role' }),
    ...games(3, 0, { hero: 'ana', role: 'support', queue: 'role' }), // off-pool support
    ...games(6, 3, { hero: 'zarya', role: 'tank', queue: 'open' }),
    ...games(5, 2, { hero: 'junkrat', role: 'dps', queue: 'role', mode: 'quickplay' }),
  ]
}

function makeNarrow() {
  return {
    pickRole: vi.fn(), pickHero: vi.fn(), setPoolFilter: vi.fn(),
    poolFilter: ref(null), pickedRoles: ref(new Set<string>()),
    pickedQueues: ref(new Set<string>()), pickedPlayModes: ref(new Set<string>()),
  }
}
function mountBand(narrow = makeNarrow()) {
  return mountWidget(MatchHeroPoolBand, { dossier: { records: corpus() }, narrow: narrow as unknown as Partial<NarrowApi> })
}

describe('MatchHeroPoolBand', () => {
  it('defaults to Role Queue with a 3-mode toggle and per-role pools', () => {
    const w = mountBand()
    expect(w.find('.hp-eyebrow').text()).toBe('Hero Pool')
    expect(w.findAll('[data-pool-mode]')).toHaveLength(3)
    expect(w.find('[data-pool-mode="role"]').attributes('aria-pressed')).toBe('true')
    // Per-role pools: tank (reinhardt) + support (lucio in, ana out).
    expect(w.find('[data-pool-role-header="tank"]').text()).toContain('%')
    expect(w.find('[data-pool-role-header="support"]').exists()).toBe(true)
    expect(w.find('[data-pool-hero="reinhardt"]').exists()).toBe(true)
    expect(w.find('[data-pool-hero="lucio"]').exists()).toBe(true)
    expect(w.find('[data-pool-hero="ana"]').exists()).toBe(true) // out-of-pool support
  })

  it('clicking a hero scopes to the queue mode and picks the hero', async () => {
    const narrow = makeNarrow()
    const w = mountBand(narrow)
    await w.find('[data-pool-hero="reinhardt"]').trigger('click')
    expect(narrow.pickHero).toHaveBeenCalledWith('reinhardt')
    expect(narrow.pickedPlayModes.value.has('competitive')).toBe(true)
    expect(narrow.pickedQueues.value.has('role')).toBe(true)
  })

  it('selecting Support Out-of-pool sets a role-scoped off-pool filter', async () => {
    const narrow = makeNarrow()
    const w = mountBand(narrow)
    await w.find('[data-pool-side="off"][data-pool-role="support"]').trigger('click')
    expect(narrow.setPoolFilter).toHaveBeenCalled()
    const arg = (narrow.setPoolFilter.mock.calls[0]![0]) as { side: string; keys: string[] }
    expect(arg.side).toBe('off')
    expect(arg.keys).toEqual(['lucio']) // support pool = lucio; ana is off
    expect(narrow.pickedRoles.value.has('support')).toBe(true)
  })

  it('switching to Open Queue shows one combined pool (no role headers)', async () => {
    const narrow = makeNarrow()
    const w = mountBand(narrow)
    await w.find('[data-pool-mode="open"]').trigger('click')
    expect(w.findAll('[data-pool-role-header]')).toHaveLength(0)
    expect(w.find('.hp-combined-head').exists()).toBe(true)
    expect(narrow.pickedQueues.value.has('open')).toBe(true)
  })
})
