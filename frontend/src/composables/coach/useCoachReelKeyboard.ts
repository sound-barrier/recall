import { nextTick, onScopeDispose, toValue, type MaybeRefOrGetter, type Ref } from 'vue'

// Keyboard for the Film Room's reel: a roving cursor over the frames.
//
// Inside the reel, ArrowUp/ArrowDown (and their vim aliases k/j) step
// frame to frame, Home/End jump to the ends; the newly selected frame
// takes focus, so the tab stop follows the selection (each frame is
// tabbable only while it is the current one — CoachReelFrame owns that
// half). `[` and `]` do the same stepping from anywhere in the room —
// the coach's hands are on the note, not the reel — and are ignored
// while a text field has focus so a literal bracket types through.

export interface CoachReelKeyboardOptions {
  /** Match keys in reel order. */
  keys: MaybeRefOrGetter<string[]>
  /** The frame currently on the desk. */
  activeKey: MaybeRefOrGetter<string>
  select: (matchKey: string) => void
  /** The reel container — the frame that gains the selection is focused inside it. */
  reel?: Ref<HTMLElement | null>
}

export interface CoachReelKeyboardApi {
  /** Bind on the reel container; frames bubble their keydown up to it. */
  onReelKeydown: (e: KeyboardEvent) => void
}

// The index a reel key asks for, or null when the key isn't ours. Out
// of range is left to the caller: the reel's ends are ends, not a wrap.
function reelTargetIndex(key: string, current: number, length: number): number | null {
  if (key === 'ArrowDown' || key === 'j') return current + 1
  if (key === 'ArrowUp' || key === 'k') return current - 1
  if (key === 'Home') return 0
  if (key === 'End') return length - 1
  return null
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function isBracketStep(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  if (e.key !== '[' && e.key !== ']') return false
  return !isEditableTarget(e.target)
}

export function useCoachReelKeyboard(opts: CoachReelKeyboardOptions): CoachReelKeyboardApi {
  function focusFrame(matchKey: string): void {
    opts.reel?.value?.querySelector<HTMLElement>(`[data-match-key="${matchKey}"]`)?.focus()
  }

  function moveTo(index: number): void {
    const key = toValue(opts.keys)[index]
    if (key === undefined) return
    opts.select(key)
    void nextTick(() => focusFrame(key))
  }

  function currentIndex(): number {
    return toValue(opts.keys).indexOf(toValue(opts.activeKey))
  }

  function onReelKeydown(e: KeyboardEvent): void {
    const keys = toValue(opts.keys)
    const current = currentIndex()
    if (current < 0) return
    const target = reelTargetIndex(e.key, current, keys.length)
    if (target === null) return
    e.preventDefault()
    moveTo(target)
  }

  function onDocumentKeydown(e: KeyboardEvent): void {
    if (!isBracketStep(e)) return
    const current = currentIndex()
    if (current < 0) return
    e.preventDefault()
    moveTo(current + (e.key === ']' ? 1 : -1))
  }

  document.addEventListener('keydown', onDocumentKeydown)
  onScopeDispose(() => document.removeEventListener('keydown', onDocumentKeydown))

  return { onReelKeydown }
}
