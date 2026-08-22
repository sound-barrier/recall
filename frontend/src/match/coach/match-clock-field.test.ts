import { describe, expect, it } from 'vitest'

import { parseMatchClock } from '@/match/coach/coach-notes'
import {
  EMPTY_CLOCK, clockSegmentAt, popClockDigit, pushClockDigit, stepClockSegment,
} from '@/match/coach/match-clock-field'

/** Types a whole string of digits, the way a coach would. */
function type(digits: string, from = EMPTY_CLOCK): string {
  return [...digits].reduce(pushClockDigit, from)
}

describe('typing a match clock', () => {
  it('starts at 00:00 so there is never a colon to type', () => {
    expect(EMPTY_CLOCK).toBe('00:00')
    expect(parseMatchClock(EMPTY_CLOCK)).toBe('00:00')
  })

  it('shifts digits in from the right', () => {
    expect(pushClockDigit('00:00', '4')).toBe('00:04')
    expect(pushClockDigit('00:04', '1')).toBe('00:41')
    expect(pushClockDigit('00:41', '2')).toBe('04:12')
  })

  // The whole point: three keystrokes, no punctuation.
  it('turns 412 into 04:12', () => {
    expect(type('412')).toBe('04:12')
  })

  it('drops the oldest digit once the field is full', () => {
    expect(type('12345')).toBe('23:45')
  })

  it('ignores anything that is not a digit — including the colon', () => {
    expect(pushClockDigit('04:12', ':')).toBe('04:12')
    expect(pushClockDigit('04:12', 'a')).toBe('04:12')
    expect(pushClockDigit('04:12', ' ')).toBe('04:12')
  })

  it('backspaces by shifting right, and bottoms out at 00:00', () => {
    expect(popClockDigit('04:12')).toBe('00:41')
    expect(popClockDigit('00:41')).toBe('00:04')
    expect(popClockDigit('00:04')).toBe('00:00')
    expect(popClockDigit('00:00')).toBe('00:00')
  })

  // A coach typing 07:52 passes through 00:75. Clamping there would make the
  // NEXT keystroke produce something they did not ask for.
  it('lets an in-progress value be briefly impossible', () => {
    expect(type('075')).toBe('00:75')
    expect(type('0752')).toBe('07:52')
    expect(parseMatchClock('07:52')).toBe('07:52')
  })

  it('reads whatever was already stored, however it was written', () => {
    expect(pushClockDigit('4:12', '5')).toBe('41:25')
    expect(pushClockDigit('', '5')).toBe('00:05')
  })
})

describe('nudging a match clock', () => {
  it('knows which half the caret is in', () => {
    expect(clockSegmentAt(0)).toBe('minutes')
    expect(clockSegmentAt(2)).toBe('minutes')
    expect(clockSegmentAt(3)).toBe('seconds')
    expect(clockSegmentAt(5)).toBe('seconds')
  })

  it('steps each half on its own', () => {
    expect(stepClockSegment('04:12', 'minutes', 1)).toBe('05:12')
    expect(stepClockSegment('04:12', 'seconds', 1)).toBe('04:13')
    expect(stepClockSegment('04:12', 'minutes', -1)).toBe('03:12')
  })

  // Dials, not arithmetic: seconds past 59 do not carry into minutes,
  // because the coach is reading a number off a scrubber.
  it('wraps within a segment rather than carrying', () => {
    expect(stepClockSegment('04:59', 'seconds', 1)).toBe('04:00')
    expect(stepClockSegment('04:00', 'seconds', -1)).toBe('04:59')
    expect(stepClockSegment('99:12', 'minutes', 1)).toBe('00:12')
    expect(stepClockSegment('00:12', 'minutes', -1)).toBe('99:12')
  })

  it('never produces something the parser rejects', () => {
    for (const seg of ['minutes', 'seconds'] as const) {
      for (let i = 0; i < 120; i++) {
        const out = stepClockSegment('00:00', seg, i)
        expect(parseMatchClock(out), `${seg} +${i} gave ${out}`).not.toBeNull()
      }
    }
  })
})
