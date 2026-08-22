import {
  EMPTY_CLOCK, clockSegmentAt, popClockDigit, pushClockDigit, stepClockSegment,
} from '@/match/coach/match-clock-field'

/**
 * What a keystroke means to a clock field.
 *
 * `swallow` is the one worth naming: a printable character that is not a
 * digit — the colon above all — does NOTHING rather than reaching the value.
 * A coach pressing `:` out of habit should get no punishment for it.
 * `pass` is everything the field has no opinion about: Tab, Home/End,
 * left/right, and every key whose name is longer than one character.
 */
type ClockIntent = 'digit' | 'erase' | 'nudge' | 'swallow' | 'pass'

const ERASE_KEYS = new Set(['Backspace', 'Delete'])
const NUDGE_KEYS = new Map([['ArrowUp', 1], ['ArrowDown', -1]])

function intentOf(key: string): ClockIntent {
  if (/^\d$/.test(key)) return 'digit'
  if (ERASE_KEYS.has(key)) return 'erase'
  if (NUDGE_KEYS.has(key)) return 'nudge'
  return key.length === 1 ? 'swallow' : 'pass'
}

/** Whether the browser should keep the keystroke: a shortcut, not an edit. */
function isShortcut(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey || event.altKey
}

/**
 * Whether the field may be empty at all.
 *
 * A MOMENT needs a clock — it points at a second of a replay, and one
 * without a time is not a moment — so its field is always MM:SS and there is
 * nothing to clear. A NOTE's clock is optional: it is about the match, and
 * "somewhere in this game" is a real thing for a coach to mean. For that one,
 * `00:00` is a genuine value (the opening seconds) rather than "unset", so
 * backspacing off the end has to give a way back to no clock at all.
 */
export interface MatchClockFieldOptions {
  clearable?: boolean
}

/**
 * Keyboard wiring for a match-clock input.
 *
 * Three fields take an in-match clock — the note's own, a moment being
 * edited, and a moment being added — and a coach uses all three in one
 * sitting. They have to behave identically, so the behavior lives here
 * rather than three times.
 *
 * The field owns its shape: it is always `MM:SS`, so the colon is never
 * typed and never deleted. Digits shift in from the right, backspace shifts
 * them out, and the arrows nudge whichever half the caret sits in. Every
 * other printable key is swallowed — a coach mashing `:` out of habit should
 * get nothing rather than a broken value.
 */
export function useMatchClockField(
  read: () => string,
  write: (next: string) => void,
  options: MatchClockFieldOptions = {},
) {
  function onKeydown(event: KeyboardEvent): void {
    // Never intercept a shortcut. Ctrl/Cmd+A and friends still work.
    if (isShortcut(event)) return

    const intent = intentOf(event.key)
    if (intent === 'pass') return
    event.preventDefault()

    switch (intent) {
      case 'digit':
        // An empty clearable field starts from 00:00 on the first keystroke,
        // so the digit lands in the seconds where the coach expects it.
        write(pushClockDigit(read() || EMPTY_CLOCK, event.key))
        break
      case 'erase':
        write(clearedOrPopped(read()))
        break
      case 'nudge':
        write(nudged(event))
        break
      case 'swallow':
        break
    }
  }

  function nudged(event: KeyboardEvent): string {
    const caret = (event.target as HTMLInputElement).selectionStart ?? 0
    const delta = NUDGE_KEYS.get(event.key) ?? 0
    return stepClockSegment(read() || EMPTY_CLOCK, clockSegmentAt(caret), delta)
  }

  // Backspacing at 00:00 is the only way back to "no clock", so a clearable
  // field takes it rather than sitting at a value the coach did not choose.
  function clearedOrPopped(current: string): string {
    if (options.clearable && (current === '' || current === EMPTY_CLOCK)) return ''
    return popClockDigit(current || EMPTY_CLOCK)
  }

  return { onKeydown }
}
