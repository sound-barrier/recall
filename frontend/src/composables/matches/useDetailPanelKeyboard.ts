import { onBeforeUnmount, onMounted, type Ref } from 'vue'

import { useSmoothScroll } from '@/composables/matches/useSmoothScroll'

// 80px is the historical fallback before the body is mounted; the live step
// derives from the body's line-height (see scrollStepPx).
const SCROLL_STEP_FALLBACK_PX = 80

// Document-level keyboard navigation for the match detail panel:
//
//   • ← / → / k j / h l → previous / next match (timeline metaphor: left earlier,
//                          right later; j/k/h/l are vim-style alternates).
//   • ↑ / ↓             → scroll the panel BODY (not the page behind) by ~3.5
//                          text rows, derived from the body's line-height.
//   • PageUp/Down + Space → scroll the body one viewport height.
//   • Home / End         → top / bottom of the body.
//
// Input-gated: while focus is in a textarea / input / select / contenteditable,
// every key passes through to native editing. Escape inside an editable blurs
// the field (cancels the edit) and stops propagation BEFORE useModalFocusTrap's
// document listener (registered after this one) closes the dialog — so a draft
// note isn't lost. Escape + Tab/Shift+Tab themselves are owned by
// useModalFocusTrap, not here.
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

  function onKeydown(e: KeyboardEvent) {
    if (!isOpen.value) return
    const target = document.activeElement as HTMLElement | null
    const tag = target?.tagName ?? ''
    const inEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
      !!target?.isContentEditable

    if (e.key === 'Escape' && inEditable) {
      e.preventDefault()
      e.stopImmediatePropagation()
      target?.blur()
      return
    }

    if (inEditable) return

    switch (e.key) {
      case 'ArrowRight':
      case 'j':
      case 'l':
        if (canNext.value) { e.preventDefault(); onNext() }
        return
      case 'ArrowLeft':
      case 'k':
      case 'h':
        if (canPrev.value) { e.preventDefault(); onPrev() }
        return
      case 'ArrowDown':
        e.preventDefault()
        nudgeScroll(scrollStepPx())
        return
      case 'ArrowUp':
        e.preventDefault()
        nudgeScroll(-scrollStepPx())
        return
      case 'PageDown':
      case ' ': {
        const el = bodyRef.value
        if (!el) return
        e.preventDefault()
        nudgeScroll(el.clientHeight - 40)
        return
      }
      case 'PageUp': {
        const el = bodyRef.value
        if (!el) return
        e.preventDefault()
        nudgeScroll(-(el.clientHeight - 40))
        return
      }
      case 'Home':
        e.preventDefault()
        setScrollAbsolute(0)
        return
      case 'End': {
        const el = bodyRef.value
        if (!el) return
        e.preventDefault()
        setScrollAbsolute(el.scrollHeight)
        return
      }
    }
  }

  onMounted(() => document.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
}
