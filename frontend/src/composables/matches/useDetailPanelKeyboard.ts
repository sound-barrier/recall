import { onBeforeUnmount, onMounted, type Ref } from 'vue'

import { useSmoothScroll } from '@/composables/matches/useSmoothScroll'

// 80px is the historical fallback before the body is mounted; the live step
// derives from the body's line-height (see scrollStepPx).
const SCROLL_STEP_FALLBACK_PX = 80

// While focus is in a textarea / input / select / contenteditable,
// every key passes through to native editing.
function isEditingTarget(target: HTMLElement | null): boolean {
  const tag = target?.tagName ?? ''
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable
}

// Document-level keyboard navigation for the match detail panel:
//
//   • ← / → / k j / h l → previous / next match (timeline metaphor: left earlier,
//                          right later; j/k/h/l are vim-style alternates).
//   • ↑ / ↓             → scroll the panel BODY (not the page behind) by ~3.5
//                          text rows, derived from the body's line-height.
//   • PageUp/Down + Space → scroll the body one viewport height.
//   • Home / End         → top / bottom of the body.
//
// Input-gated: while focus is in an editable, every key passes through to
// native editing. Escape inside an editable blurs the field (cancels the edit)
// and stops propagation BEFORE useModalFocusTrap's document listener
// (registered after this one) closes the dialog — so a draft note isn't lost.
// Escape + Tab/Shift+Tab themselves are owned by useModalFocusTrap, not here.
export function useDetailPanelKeyboard(opts: {
  isOpen: Ref<boolean>
  bodyRef: Ref<HTMLElement | null>
  canPrev: Ref<boolean>
  canNext: Ref<boolean>
  onPrev: () => void
  onNext: () => void
}) {
  const { isOpen, bodyRef, canPrev, canNext, onPrev, onNext } = opts
  const { nudgeScroll, setScrollAbsolute } = useSmoothScroll(bodyRef)

  function scrollStepPx(): number {
    const lineHeight = bodyRef.value ? parseFloat(getComputedStyle(bodyRef.value).lineHeight) : NaN
    return Number.isFinite(lineHeight) && lineHeight > 0
      ? Math.round(lineHeight * 3.5)
      : SCROLL_STEP_FALLBACK_PX
  }

  function goNext(e: KeyboardEvent) {
    if (canNext.value) { e.preventDefault(); onNext() }
  }

  function goPrev(e: KeyboardEvent) {
    if (canPrev.value) { e.preventDefault(); onPrev() }
  }

  // Scroll actions that need the body element no-op while it's absent —
  // preventDefault only fires once there's a body to move.
  function withBody(e: KeyboardEvent, scroll: (el: HTMLElement) => void) {
    const el = bodyRef.value
    if (!el) return
    e.preventDefault()
    scroll(el)
  }

  function nudge(e: KeyboardEvent, direction: 1 | -1) {
    e.preventDefault()
    nudgeScroll(direction * scrollStepPx())
  }

  function pageDown(e: KeyboardEvent) {
    withBody(e, (el) => nudgeScroll(el.clientHeight - 40))
  }

  const keyActions: Record<string, (e: KeyboardEvent) => void> = {
    ArrowRight: goNext, j: goNext, l: goNext,
    ArrowLeft: goPrev, k: goPrev, h: goPrev,
    ArrowDown: (e) => nudge(e, 1),
    ArrowUp: (e) => nudge(e, -1),
    PageDown: pageDown, ' ': pageDown,
    PageUp: (e) => withBody(e, (el) => nudgeScroll(-(el.clientHeight - 40))),
    Home: (e) => { e.preventDefault(); setScrollAbsolute(0) },
    End: (e) => withBody(e, (el) => setScrollAbsolute(el.scrollHeight)),
  }

  function onKeydown(e: KeyboardEvent) {
    if (!isOpen.value) return
    const target = document.activeElement as HTMLElement | null
    if (isEditingTarget(target)) {
      // Escape inside an editable blurs the field (cancels the edit) and
      // stops propagation BEFORE useModalFocusTrap's document listener
      // (registered after this one) closes the dialog — so a draft note
      // isn't lost. Every other key passes through to native editing.
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        target?.blur()
      }
      return
    }
    keyActions[e.key]?.(e)
  }

  onMounted(() => document.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
}
