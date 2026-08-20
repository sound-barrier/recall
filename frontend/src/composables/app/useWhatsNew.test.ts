import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { render } from '@testing-library/vue'

import { useWhatsNew } from '@/composables/app/useWhatsNew'

// The one-time gate behind the what's-new strip: unseen until marked, the
// mark persists per FEATURE key, and one feature's dismissal never mutes
// the next one's announcement. localStorage is stubbed the way the
// persisted-pref family's own tests do (useTheme.test.ts).

const stored = new Map<string, string>()

beforeEach(() => {
  stored.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => { stored.set(k, v) },
    removeItem: (k: string) => { stored.delete(k) },
    clear: () => { stored.clear() },
    key: (i: number) => [...stored.keys()][i] ?? null,
    get length() { return stored.size },
  })
})

function mountGate(featureKey: string) {
  let gate!: ReturnType<typeof useWhatsNew>
  const Host = defineComponent({
    setup() {
      gate = useWhatsNew(featureKey)
      return () => h('div')
    },
  })
  render(Host)
  return gate
}

describe('useWhatsNew', () => {
  it('is unseen on a fresh install, and markSeen persists', () => {
    const gate = mountGate('reviewsTab')
    expect(gate.unseen()).toBe(true)
    gate.markSeen()
    expect(gate.unseen()).toBe(false)
    expect(stored.get('recall.whatsNew.reviewsTab')).toBe('seen')
  })

  it('reads a persisted dismissal back', () => {
    stored.set('recall.whatsNew.reviewsTab', 'seen')
    const gate = mountGate('reviewsTab')
    expect(gate.unseen()).toBe(false)
  })

  it('keys per feature — one dismissal never mutes the next announcement', () => {
    stored.set('recall.whatsNew.reviewsTab', 'seen')
    const next = mountGate('someNextFeature')
    expect(next.unseen()).toBe(true)
  })
})
