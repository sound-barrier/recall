import { defineComponent, h, ref } from 'vue'
import { render } from '@testing-library/vue'
import { describe, it, expect, vi } from 'vitest'

import { SHORTCUT_GROUPS } from '@/components/app/keyboard-shortcuts.data'
import type { Shortcut } from '@/composables/shared/keyboard/useKeyboardShortcuts'
import type { MatchRecord } from '@/api-client'
import type { ViewId } from '@/composables/shared/keyboard/useTabKeyboardNav'

// The "?" cheatsheet is a hand-written catalog of ~40 rows that shares no code
// with the bindings it describes, and it appeared in zero test files. A binding
// could be added, changed or removed with lint, unit and e2e all green while
// the modal kept advertising the old key — a user-facing lie no gate could
// catch (TECHNICAL_DEBT.md section 14).
//
// Collapsing the two into one catalog is not on: the sheet also documents keys
// owned by the detail panel, the command palette and the film room, none of
// which register through useGlobalKeyboard. So this is the completeness test
// the standards prescribe when a lookup cannot be collapsed — it holds the
// half that CAN drift silently, and says so rather than implying more.
vi.mock('@/composables/shared/keyboard/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: (shortcuts: readonly Shortcut[]) => { registered.push(...shortcuts) },
}))

const registered: Shortcut[] = []

// The sheet prints keys the way a reader sees them on the keyboard; the
// registry matches KeyboardEvent.key. Same key, two spellings.
const AS_PRINTED: Record<string, string> = {
  ArrowDown: '↓',
  ArrowUp: '↑',
  ArrowRight: '→',
  ArrowLeft: '←',
  Escape: 'Esc',
  ' ': 'Space',
}

const printed = (key: string): string => AS_PRINTED[key] ?? key

/**
 * Every chord the sheet advertises, in one notation.
 *
 * A row's keys are either aliases for one chord (['j','↓'] — press either) or
 * the parts of one chord (['Ctrl/Cmd','K'], ['g','m'] with seq). Aliases become
 * one entry each; multi-part chords become a joined entry.
 */
function advertisedChords(): Set<string> {
  const out = new Set<string>()
  for (const group of SHORTCUT_GROUPS) {
    for (const binding of group.bindings) {
      const isChord = binding.seq || binding.keys[0] === 'Ctrl/Cmd' || binding.keys[0] === '⇧'
      if (isChord) {
        out.add(binding.keys.join(' '))
      } else {
        for (const key of binding.keys) out.add(key)
      }
    }
  }
  return out
}

/** The chords one registration puts on the keyboard, in the sheet's notation. */
function chordsOf(s: Shortcut): string[] {
  const keys = (Array.isArray(s.key) ? s.key : [s.key as string]).map(printed)
  if (s.mod) return keys.map((k) => `Ctrl/Cmd ${k.toUpperCase()}`)
  if (s.prefix) return keys.map((k) => `${s.prefix} ${k}`)
  return keys
}

async function collectRegistrations(): Promise<Shortcut[]> {
  registered.length = 0
  const { useGlobalKeyboard } = await import('@/composables/shared/keyboard/useGlobalKeyboard')
  const view = render(defineComponent({
    setup() {
      useGlobalKeyboard({
        view: ref<ViewId>('matches'),
        openCheatsheet: ref(false),
        openPalette: ref(false),
        modalOpen: ref(false),
        selectionIsOpen: ref(false),
        selectedKey: ref<string | null>(null),
        closeSelection: vi.fn(),
        focusedCardIndex: ref(0),
        narrowedRecords: ref([{ match_key: 'm1' } as unknown as MatchRecord]),
        goToView: vi.fn(),
        focusCardByRenderedDelta: vi.fn(),
        focusCardByRenderedEnd: vi.fn(),
        focusSectionByRenderedDelta: vi.fn(),
        toggleExpand: vi.fn(),
      })
      return () => h('div')
    },
  }))
  view.unmount()
  return registered
}

describe('the cheatsheet describes the bindings that exist', () => {
  it('advertises every chord useGlobalKeyboard registers', async () => {
    const shortcuts = await collectRegistrations()
    // Pinned so the test cannot quietly start covering less: if the mock stops
    // capturing, or the registrations move somewhere else, this fails loudly
    // instead of passing over an empty list.
    expect(shortcuts).toHaveLength(19)

    const advertised = advertisedChords()
    const missing = new Set<string>()
    for (const s of shortcuts) {
      for (const chord of chordsOf(s)) {
        if (!advertised.has(chord)) missing.add(chord)
      }
    }

    expect([...missing].sort()).toEqual([])
  })
})
