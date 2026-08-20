// The focus list's pure edits — "what to work on", as rows.
//
// The editor is CONTROLLED (the note editor's rule, for the note editor's
// reason): every keystroke asks for the next list and hands it upward, so
// two sheets can share one editor without either holding a draft that could
// survive into the other's.

import type { FocusEntry, FocusItem } from '@/api'

/** The blank row an Add or an Enter creates. */
export function emptyFocusItem(): FocusItem {
  // crypto.randomUUID is available in every runtime this ships to, and the
  // id has to be minted here: it is the identity that survives export and
  // re-import, so the server must never mint a second one for the same row.
  return { item_id: crypto.randomUUID(), text: '' }
}

/** Replace one row's text. */
export function withText(items: FocusItem[], index: number, text: string): FocusItem[] {
  return items.map((item, i) => (i === index ? { ...item, text } : item))
}

/** Insert a blank row after `index` — what Enter at the end of a row means. */
export function insertAfter(items: FocusItem[], index: number): FocusItem[] {
  const next = [...items]
  next.splice(index + 1, 0, emptyFocusItem())
  return next
}

/** Drop one row. */
export function removeAt(items: FocusItem[], index: number): FocusItem[] {
  return items.filter((_, i) => i !== index)
}

/**
 * Move one row by `delta`, clamped. Reordering is buttons rather than drag:
 * the list is short, and a drag handle is one more thing that does not
 * answer to a keyboard.
 */
export function moveBy(items: FocusItem[], index: number, delta: number): FocusItem[] {
  const to = index + delta
  if (to < 0 || to >= items.length) return items
  const next = [...items]
  const [moved] = next.splice(index, 1)
  next.splice(to, 0, moved!)
  return next
}

/**
 * What actually gets saved: rows with text, trimmed. A blank row is the
 * editor's own scaffolding — the row you are about to type into — not
 * something to persist, and the server refuses it anyway.
 */
export function savableItems(items: FocusItem[]): FocusItem[] {
  return items
    .map((item) => ({ ...item, text: item.text.trim() }))
    .filter((item) => item.text !== '')
}

/** Whether two lists would save the same, so an autosave can skip a no-op. */
export function sameItems(a: FocusItem[], b: FocusItem[]): boolean {
  if (a.length !== b.length) return false
  return a.every((item, i) => item.item_id === b[i]!.item_id && item.text === b[i]!.text)
}

/**
 * The live list: everything not yet retired, in the order the server
 * already put it — coach items first, each source newest first.
 *
 * `done` is excluded rather than deleted. Retiring an item takes it off what
 * you are working on; it does not unsay what was said, and the band still
 * counts them.
 */
export function activeFocus(entries: readonly FocusEntry[]): FocusEntry[] {
  return entries.filter((e) => e.status !== 'done')
}

/** What a live session says out loud: the top three of the live list. */
export function topFocus(entries: readonly FocusEntry[]): FocusEntry[] {
  return activeFocus(entries).slice(0, 3)
}

/** Retired items, for the band's collapsed count. */
export function retiredFocus(entries: readonly FocusEntry[]): FocusEntry[] {
  return entries.filter((e) => e.status === 'done')
}
