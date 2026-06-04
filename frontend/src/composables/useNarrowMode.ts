import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

import { usePersistedRef } from './usePersistedRef'

// Reactive "rail vs popover" mode for the Matches narrow filter.
// Two inputs:
//
//   1. Viewport width — wider than the breakpoint => `rail` (always-
//      visible aside in column 1 of the matches-set-workspace grid);
//      narrower => `popover` (the historical modal slide-in).
//
//   2. User override persisted via usePersistedRef under
//      `recall.matchesNarrowMode`. Values: 'rail' | 'popover' |
//      'auto'. Default 'auto' = viewport-driven; 'rail' / 'popover'
//      force the corresponding mode regardless of viewport. The
//      override has no UI surface in this PR; it exists for dev
//      testing and a future "Manage layout" panel.

export type NarrowMode = 'rail' | 'popover'
export type NarrowModeOverride = 'rail' | 'popover' | 'auto'

const NARROW_RAIL_BREAKPOINT = 1400

function parseOverride(raw: string): NarrowModeOverride | undefined {
  if (raw === 'rail' || raw === 'popover' || raw === 'auto') return raw
  return undefined
}

export function useNarrowMode(): { mode: Ref<NarrowMode>; override: Ref<NarrowModeOverride>; setOverride: (next: NarrowModeOverride) => void } {
  const { value: override, set: setOverride } = usePersistedRef<NarrowModeOverride>({
    key: 'recall.matchesNarrowMode',
    defaultValue: 'auto',
    parse: parseOverride,
  })

  const viewportWide = ref(typeof window !== 'undefined' && window.innerWidth >= NARROW_RAIL_BREAKPOINT)
  const mode = ref<NarrowMode>(override.value === 'auto' ? (viewportWide.value ? 'rail' : 'popover') : override.value)

  function recompute() {
    if (typeof window !== 'undefined') {
      viewportWide.value = window.innerWidth >= NARROW_RAIL_BREAKPOINT
    }
    mode.value = override.value === 'auto' ? (viewportWide.value ? 'rail' : 'popover') : override.value
  }

  onMounted(() => {
    window.addEventListener('resize', recompute, { passive: true })
  })
  onBeforeUnmount(() => {
    window.removeEventListener('resize', recompute)
  })

  return { mode, override, setOverride }
}
