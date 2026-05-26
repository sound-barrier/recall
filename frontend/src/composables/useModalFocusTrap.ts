import { nextTick, ref, watch, type Ref } from 'vue'

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
}

export function useModalFocusTrap(
  open: Ref<boolean>,
  { containerSelector }: ModalFocusTrapOptions,
) {
  const lastFocusedBeforeModal = ref<HTMLElement | null>(null)

  function focusable(): HTMLElement[] {
    const box = document.querySelector<HTMLElement>(containerSelector)
    if (!box) return []
    const sel = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    return Array.from(box.querySelectorAll<HTMLElement>(sel))
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      open.value = false
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
      focusable()[0]?.focus()
    } else {
      document.removeEventListener('keydown', onKeydown)
      const prev = lastFocusedBeforeModal.value
      lastFocusedBeforeModal.value = null
      // Defer focus restore one tick so the modal's DOM is gone
      // first; restoring before the focused element is removed can
      // be a no-op in some browsers.
      await nextTick()
      prev?.focus()
    }
  })

  return { focusable, onKeydown }
}
