import { nextTick, ref } from 'vue'

// Card-focus state for the Matches list — the flat narrowedRecords index of the
// leaf-row the keyboard motions target (j/k, gg/G, n/N, and the e/t panel
// openers), plus the DOM-order walk helpers App.vue threads into
// useGlobalKeyboard. Focus is driven off RENDERED DOM order (the
// `.leaf-row[data-card-index]` sequence) rather than narrowedRecords order, so
// it stays correct under any sort or grouping.
//
// Extracted from App.vue so the focus walk can be unit-reasoned in isolation and
// App.vue stays the router-shell (REVIEW.md Q13).
export function useCardFocus() {
  // -1 = no card focused; the leaf-row's roving tabindex reads this and flips
  // between 0 / -1.
  const focusedCardIndex = ref(-1)

  // Programmatically focus the leaf-row at the given narrowedRecords index. We
  // query-select by data-card-index because the row lives inside MatchesView's
  // grouped section list and template refs would be awkward across the section
  // dividers.
  async function focusCardByIndex(idx: number) {
    focusedCardIndex.value = idx
    await nextTick()
    const el = document.querySelector<HTMLElement>(
      `.leaf-row[data-card-index="${idx}"]`,
    )
    el?.focus({ preventScroll: false })
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'auto' })
  }

  // Walk to the next/prev leaf-row in RENDERED order (DOM-document order under
  // .leaves-list), so j/k follow the visible list even when Sort=Oldest. No
  // wrap at the ends.
  async function focusCardByRenderedDelta(delta: 1 | -1) {
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>('.leaf-row[data-card-index]'),
    )
    if (rows.length === 0) return
    let currentRowIdx = -1
    if (focusedCardIndex.value !== -1) {
      currentRowIdx = rows.findIndex(
        (r) => Number(r.dataset.cardIndex) === focusedCardIndex.value,
      )
    }
    let nextRowIdx: number
    if (currentRowIdx === -1) {
      // No card focused yet — first j lands on row 0, first k on row 0 too
      // (preserves the pre-fix "k from -1 lands on 0" behavior).
      nextRowIdx = 0
    } else {
      nextRowIdx = Math.max(
        0,
        Math.min(rows.length - 1, currentRowIdx + delta),
      )
    }
    const target = rows[nextRowIdx]
    if (!target) return
    const newIndex = Number(target.dataset.cardIndex)
    if (Number.isNaN(newIndex)) return
    if (newIndex === focusedCardIndex.value) return
    await focusCardByIndex(newIndex)
  }

  // Jump card focus to the first / last rendered leaf-row (vim gg / G).
  async function focusCardByRenderedEnd(which: 'first' | 'last') {
    const rows = document.querySelectorAll<HTMLElement>('.leaf-row[data-card-index]')
    if (rows.length === 0) return
    const target = which === 'first' ? rows[0] : rows[rows.length - 1]
    const newIndex = Number(target?.dataset.cardIndex)
    if (Number.isNaN(newIndex)) return
    await focusCardByIndex(newIndex)
  }

  // Collect the first leaf-row of each grouped section — the row that follows
  // each `.section-divider` (the list start counts as a boundary).
  function sectionAnchorRows(): HTMLElement[] {
    const list = document.querySelector('.leaves-list')
    if (!list) return []
    const anchors: HTMLElement[] = []
    let sawDivider = true // list start is a section boundary
    for (const child of Array.from(list.children) as HTMLElement[]) {
      if (child.classList.contains('section-divider')) {
        sawDivider = true
        continue
      }
      if (child.classList.contains('leaf-row') && child.dataset.cardIndex != null) {
        if (sawDivider) {
          anchors.push(child)
          sawDivider = false
        }
      }
    }
    return anchors
  }

  // Jump card focus to the first row of the next / prev grouped section
  // (vim n / N). No-op when the list is ungrouped (one anchor only).
  async function focusSectionByRenderedDelta(delta: 1 | -1) {
    const anchors = sectionAnchorRows()
    if (anchors.length <= 1) return
    // Current section = index of the last anchor at-or-before the focused row in
    // document order; -1 / length when no card is focused yet so a first n/N
    // lands on the first/last section.
    let current = delta > 0 ? -1 : anchors.length
    if (focusedCardIndex.value !== -1) {
      const focusedRow = document.querySelector<HTMLElement>(
        `.leaf-row[data-card-index="${focusedCardIndex.value}"]`,
      )
      if (focusedRow) {
        for (let i = 0; i < anchors.length; i++) {
          const anchor = anchors[i]!
          const atOrBefore = anchor === focusedRow ||
            (anchor.compareDocumentPosition(focusedRow) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
          if (atOrBefore) current = i
          else break
        }
      }
    }
    const targetIdx = Math.max(0, Math.min(anchors.length - 1, current + delta))
    const target = anchors[targetIdx]
    if (!target) return
    const newIndex = Number(target.dataset.cardIndex)
    if (Number.isNaN(newIndex)) return
    await focusCardByIndex(newIndex)
  }

  return {
    focusedCardIndex,
    focusCardByRenderedDelta,
    focusCardByRenderedEnd,
    focusSectionByRenderedDelta,
  }
}
