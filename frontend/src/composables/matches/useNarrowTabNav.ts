import { onScopeDispose, type Ref } from 'vue'

// Narrow-set panel Tab rule.
//
// Inside the filter panel the text inputs (search, custom-date, the
// Map/Hero combobox typeaheads) are interleaved with the toggle/chip
// buttons. Tabbing field-to-field is slow when you only want the
// toggles, so: when focus is in an EMPTY text input in the panel,
// Tab jumps to the NEXT toggle button (Shift+Tab to the previous one)
// instead of the next text input.
//
// Guard-rails that keep this accessible:
//   - Only EMPTY inputs trigger the skip. The moment you type a value,
//     Tab behaves normally so you can move off a half-typed field.
//   - It never traps: when there's no toggle left in the Tab direction,
//     the handler does nothing and the browser's native Tab carries
//     focus out of the panel (and the modal focus-trap, in popover
//     mode, wraps as usual).
//   - Scoped to the passed container only — Tab everywhere else in the
//     app is untouched.

function isEmptyTextInput(
  el: Element | null,
): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return el.value === ''
  if (!(el instanceof HTMLInputElement)) return false
  // Non-text input types (checkbox/radio/button/range) aren't "text
  // boxes" the rule applies to.
  const textLike = ['text', 'search', 'date', 'number', 'email', 'url', 'tel']
  if (!textLike.includes(el.type)) return false
  return el.value === ''
}

function isVisible(el: HTMLElement): boolean {
  return el.offsetParent !== null || el.getClientRects().length > 0
}

export function useNarrowTabNav(container: Ref<HTMLElement | null>): void {
  function toggleButtons(root: HTMLElement): HTMLElement[] {
    return Array.from(
      root.querySelectorAll<HTMLElement>('button:not([disabled])'),
    ).filter(isVisible)
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return
    const root = container.value
    const active = document.activeElement
    if (!root || !isEmptyTextInput(active) || !root.contains(active)) return

    const buttons = toggleButtons(root)
    if (buttons.length === 0) return

    let target: HTMLElement | undefined
    if (!e.shiftKey) {
      target = buttons.find(
        (b) =>
          (active.compareDocumentPosition(b) &
            Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      )
    } else {
      target = [...buttons]
        .reverse()
        .find(
          (b) =>
            (active.compareDocumentPosition(b) &
              Node.DOCUMENT_POSITION_PRECEDING) !== 0,
        )
    }
    // No toggle left this way → let native Tab carry focus out (no trap).
    if (!target) return
    e.preventDefault()
    target.focus()
  }

  // Capture phase so we win over the modal focus-trap's own Tab handler
  // for the in-panel empty-input case; the trap still handles the
  // edge-wrap case (where we deliberately don't preventDefault).
  document.addEventListener('keydown', onKeydown, true)
  onScopeDispose(() =>
    document.removeEventListener('keydown', onKeydown, true),
  )
}
