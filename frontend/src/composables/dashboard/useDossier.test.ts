import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useDossier, provideDossier } from '@/composables/dashboard/useDossier'
import type { MatchesDossier } from '@/composables/matches/useMatchesDossier'

// A minimal hand-built mock dossier. The test only needs the
// useDossier() typed-inject path to work, so most fields can be
// `undefined as never` — the test components below don't actually
// read them. Cast tightens the shape so future API additions don't
// silently lose type safety here.
function fakeDossier(): MatchesDossier {
  return {} as MatchesDossier
}

describe('useDossier / provideDossier', () => {
  it('inject returns the value provided up the tree', () => {
    const fake = fakeDossier()
    let captured: MatchesDossier | null = null
    const Child = defineComponent({
      setup() {
        captured = useDossier()
        return () => h('div')
      },
    })
    const Parent = defineComponent({
      setup() {
        provideDossier(fake)
        return () => h(Child)
      },
    })
    mount(Parent)
    expect(captured).toBe(fake)
  })

  it('throws when called outside a provider', () => {
    const Orphan = defineComponent({
      setup() {
        useDossier()
        return () => h('div')
      },
    })
    expect(() => mount(Orphan)).toThrow(/useDossier\(\) called outside/)
  })
})
