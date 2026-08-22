/**
 * Typing an in-match clock.
 *
 * A coach transcribing a moment is watching a replay, not filling in a form.
 * The field used to be free text with an `MM:SS` placeholder, which meant
 * reaching for the colon key every single time — for a value they enter over
 * and over in one sitting.
 *
 * So digits shift in from the RIGHT, the way a stopwatch or a microwave
 * takes a time: the field starts at `00:00`, and typing 4, 1, 2 walks it
 * 00:04 → 00:41 → 04:12. The colon is never typed because it is never
 * absent. There are no hours: a match clock is minutes and seconds, and a
 * third segment nobody would key is a third segment to tab past.
 *
 * These are pure string transforms so the behavior can be tested without a
 * DOM — the components own the keyboard wiring, this owns the rules.
 */

/** What an untouched field shows, and what backspacing to the end returns. */
export const EMPTY_CLOCK = '00:00'

/** Where the caret is, which decides what an arrow key steps. */
export type ClockSegment = 'minutes' | 'seconds'

const MINUTES_MAX = 99
const SECONDS_MAX = 59

/** The four digits behind a clock, tolerant of anything already stored. */
function digitsOf(clock: string): string {
  return clock.replace(/\D/g, '').padStart(4, '0').slice(-4)
}

function format(digits: string): string {
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

/**
 * Appends one digit, shifting the rest left.
 *
 * Deliberately does NOT clamp: a coach typing 07:52 passes through 00:75 on
 * the way, and a field that "helpfully" corrected that to 00:59 would make
 * the next keystroke produce something they did not ask for. Correctness is
 * a question for the finished value, which `parseMatchClock` already answers.
 */
export function pushClockDigit(clock: string, digit: string): string {
  if (!/^\d$/.test(digit)) return clock
  return format((digitsOf(clock) + digit).slice(-4))
}

/** Removes the last digit, shifting the rest right — backspace's mirror. */
export function popClockDigit(clock: string): string {
  return format(('0' + digitsOf(clock)).slice(0, 4))
}

/** Which half of the field a caret position sits in. `MM:SS` — 0..2 is minutes. */
export function clockSegmentAt(caret: number): ClockSegment {
  return caret <= 2 ? 'minutes' : 'seconds'
}

/**
 * Steps one segment by `delta`, wrapping at its own ceiling.
 *
 * Wrapping rather than saturating because these are dials: a coach nudging
 * seconds down from 00 means 59, not "nothing happens". Minutes and seconds
 * are independent — stepping seconds past 59 does not carry into minutes,
 * because the coach is reading a number off a replay scrubber, not doing
 * arithmetic.
 */
export function stepClockSegment(clock: string, segment: ClockSegment, delta: number): string {
  const digits = digitsOf(clock)
  const minutes = Number(digits.slice(0, 2))
  const seconds = Number(digits.slice(2))
  if (segment === 'minutes') {
    return format(pad(wrap(minutes + delta, MINUTES_MAX)) + pad(seconds))
  }
  return format(pad(minutes) + pad(wrap(seconds + delta, SECONDS_MAX)))
}

function wrap(value: number, max: number): number {
  const span = max + 1
  return ((value % span) + span) % span
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
