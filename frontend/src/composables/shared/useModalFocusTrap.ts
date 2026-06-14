import { nextTick, ref, watch, type Ref } from 'vue'

import { useScrollLock } from '@/composables/shared/useScrollLock'

// WAI-ARIA dialog focus management.
//
// When `open.value` flips true the composable:
//   1. captures the trigger element (so we can restore focus on close);
//   2. moves focus to the first focusable inside `containerSelector`
//      (the markup-first item — usually the safe/cancel button, not a
//      destructive primary action);
//   3. installs a keydown listener that traps Tab / Shift+Tab inside
//      the container and treats Escape as a cancel.
// When `open.value` flips false the listener is removed and focus
// returns to the captured trigger on the next tick (the modal's DOM
// must unmount before focus restore, otherwise some browsers no-op).
//
// Extracted from App.vue's inline implementation so the focus-trap
// pattern is reusable for any future modal and so the keyboard contract
// is unit-testable in isolation.

export interface ModalFocusTrapOptions {
  // CSS selector for the element whose descendants form the focus
  // ring (typically the modal's content box, NOT the overlay).
  containerSelector: string
  // Optional explicit close callback. Pass when the `open` ref is a
  // derived ref (e.g. `toRef(props, 'open')`) whose source can't be
  // written through — the cheatsheet modal lives behind a prop and
  // closing requires an `emit('close')`, not a local mutation. When
  // omitted, the composable falls back to writing `open.value = false`
  // directly (correct for the case where the caller owns the ref).
  onClose?: () => void
}

export function useModalFocusTrap(
  open: Ref<boolean>,
  { containerSelector, onClose }: ModalFocusTrapOptions,
) {
  const lastFocusedBeforeModal = ref<HTMLElement | null>(null)

  // Every focus-trapped overlay also freezes the page scroll while open
  // — `inert` on the background blocks focus/click/keyboard but not the
  // mouse wheel, so without this the list behind the overlay (and
  // anchored popovers like the widget-config gear) scrolls out from
  // under it. Reference-counted, so nested overlays stay locked until
  // the last closes. Surfaces that don't use this trap (the dropdown
  // menus, context menu, lightbox, export/ignored panels) call
  // useScrollLock directly; the onboarding tour keeps its own lock.
  useScrollLock(open)

  function focusable(): HTMLElement[] {
    const box = document.querySelector<HTMLElement>(containerSelector)
    if (!box) return []
    const sel = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    return Array.from(box.querySelectorAll<HTMLElement>(sel))
  }

  function close() {
    if (onClose) onClose()
    else open.value = false
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key !== 'Tab') return
    const items = focusable()
    if (items.length === 0) return
    const first = items[0]!
    const last  = items[items.length - 1]!
    const active = document.activeElement as HTMLElement | null
    if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  // `immediate: true` so a modal that's lazy-loaded with `open`
  // already true (e.g. KeyboardShortcutsModal mounted after `?`
  // already flipped openCheatsheet=true) gets its Esc handler +
  // focus trap on first run. Without immediate the watcher tracks
  // FUTURE changes only and the first open silently lacks both —
  // pinned by keyboard-shortcuts.spec.ts:90 (CI-only flake).
  watch(open, async (isOpen) => {
    if (isOpen) {
      lastFocusedBeforeModal.value =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      // Install the keydown trap synchronously so Escape works
      // immediately. Initial focus waits a tick because the modal's
      // DOM may not be mounted yet on the same tick the ref flipped.
      document.addEventListener('keydown', onKeydown)
      await nextTick()
      // `preventScroll: true` keeps the modal's body from jumping
      // to wherever the first focusable lives — e.g. the cheat-
      // sheet's only focusable is the Close button at the bottom,
      // and a default `.focus()` would auto-scrollIntoView and
      // open the modal already scrolled to the foot.
      focusable()[0]?.focus({ preventScroll: true })
    } else {
      document.removeEventListener('keydown', onKeydown)
      const prev = lastFocusedBeforeModal.value
      lastFocusedBeforeModal.value = null
      // Defer focus restore one tick so the modal's DOM is gone
      // first; restoring before the focused element is removed can
      // be a no-op in some browsers. `preventScroll` so returning
      // focus to a trigger that scrolled off-screen doesn't yank the
      // page to it on close.
      await nextTick()
      prev?.focus({ preventScroll: true })
    }
  }, { immediate: true })

  return { focusable, onKeydown }
}
