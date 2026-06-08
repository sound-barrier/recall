import { ref, watch, toValue, onBeforeUnmount, type MaybeRefOrGetter } from 'vue'

import { CONTEXTUAL_CALLOUT_KEY_PREFIX } from './storageKeys'

// useContextualCallout is the trigger surface for a single
// just-in-time hint. The full OnboardingTour walks every new user
// through every surface up front; that flow is heavy and most users
// skip it. A contextual callout, by contrast, fires the first time
// a specific surface materialises in the wild — the source-picker
// grid renders, a Reference-data-gap appears in the Unknown tab —
// and nudges the user toward the affordance they're about to use
// without redirecting them.
//
// Lifecycle:
//   1. Caller passes a reactive `gate` (a getter returning boolean).
//      The composable watches the gate for the false→true edge.
//   2. On the edge, if the per-callout `seen` flag is missing AND
//      the global onboarding flag is missing, the callout fires
//      (the singleton `activeCalloutId` ref flips to this id).
//   3. The user dismisses via Esc, the close glyph, or the action
//      button. Dismissal writes `seen=true` to localStorage so the
//      callout never re-fires on this device.
//   4. A second callout firing while one is already active is
//      queued — the in-flight callout must clear first (caps to
//      one at a time avoids stacked-popover chaos).
//
// Gating is per-callout-id only. The full OnboardingTour and the
// contextual callouts serve different purposes: the tour is
// "let me show you around;" each callout is "you just hit this
// surface — here's the one-sentence read." A user who skipped the
// full tour might still be encountering a specific surface for the
// first time — they get the one-line orientation, then dismiss it
// once, and never see it again. The `seen` flag PER CALLOUT ID is
// the only durable state.

// Module-level singleton — the id of the currently-visible callout,
// or null if none. Lives at module scope so two callouts trying to
// fire at the same setup tick agree on a single winner.
export const activeCalloutId = ref<string | null>(null)

export interface ContextualCalloutOptions {
  // Stable id used as the localStorage key suffix + the e2e hook.
  // Choose something stable across renames; clearing localStorage is
  // the only way for a user to re-see a dismissed callout.
  id: string
  // Reactive gate. The composable watches the false→true edge —
  // toggling true many times in a row only fires the callout once
  // (until the user dismisses). A gate that starts true on mount
  // fires on the first onMounted tick (matches "I want this to
  // surface immediately when the surface mounts" semantics).
  gate: MaybeRefOrGetter<boolean>
}

export interface ContextualCalloutController {
  // True only when THIS callout's id matches the active singleton.
  // Bind the floating card's v-if to this.
  active: () => boolean
  // Mark the callout dismissed: writes `seen=true` to localStorage
  // and clears the singleton. Subsequent gate transitions never
  // re-fire this callout id.
  dismiss: () => void
}

function storageKey(id: string): string {
  return `${CONTEXTUAL_CALLOUT_KEY_PREFIX}${id}.seen`
}

function alreadySeen(id: string): boolean {
  try {
    return localStorage.getItem(storageKey(id)) === 'true'
  } catch (_) {
    // localStorage unavailable — treat as "seen" so the callout
    // doesn't fire in degraded environments (server-rendered tests,
    // sandboxed iframes).
    return true
  }
}

export function useContextualCallout(
  opts: ContextualCalloutOptions,
): ContextualCalloutController {
  const dismissed = ref(false)

  function dismiss(): void {
    dismissed.value = true
    try {
      localStorage.setItem(storageKey(opts.id), 'true')
    } catch (_) { /* non-browser env */ }
    if (activeCalloutId.value === opts.id) {
      activeCalloutId.value = null
    }
  }

  function maybeFire(): void {
    if (dismissed.value) return
    if (alreadySeen(opts.id)) return
    if (activeCalloutId.value !== null) return
    activeCalloutId.value = opts.id
  }

  // Watch the gate for the false→true transition. Vue's watch fires
  // on mount with the current value as the new value (and undefined
  // as the old), so a gate already true at mount registers as a
  // transition and triggers the callout immediately.
  const stop = watch(
    () => toValue(opts.gate),
    (next, prev) => {
      if (next && !prev) maybeFire()
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    stop()
    // If this callout was the visible one when the parent unmounts,
    // release the singleton so the next surface that wants it can
    // take it. We do NOT mark it seen — an unmount is not a user
    // dismissal.
    if (activeCalloutId.value === opts.id) {
      activeCalloutId.value = null
    }
  })

  return {
    active: () => activeCalloutId.value === opts.id && !dismissed.value,
    dismiss,
  }
}
