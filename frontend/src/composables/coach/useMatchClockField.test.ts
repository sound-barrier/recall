import { describe, it, expect, vi } from 'vitest'

import { useMatchClockField } from '@/composables/coach/useMatchClockField'

// The keyboard contract for a match-clock field: digits shift in, the colon
// is never typed because it is never absent, and the arrows nudge whichever
// half the caret is in. Three fields share this, so it is tested once.
function harness(initial = '00:00', options = {}) {
  let value = initial
  const { onKeydown } = useMatchClockField(() => value, (next) => { value = next }, options)
  const press = (key: string, caret = 0, mods: Record<string, boolean> = {}) => {
    const preventDefault = vi.fn()
    onKeydown({
      key, preventDefault, target: { selectionStart: caret },
      metaKey: false, ctrlKey: false, altKey: false, ...mods,
    } as unknown as KeyboardEvent)
    return preventDefault
  }
  return { press, read: () => value }
}

describe('useMatchClockField', () => {
  it('shifts digits in and swallows the keystroke', () => {
    const { press, read } = harness()
    expect(press('4')).toHaveBeenCalled()
    press('1'); press('2')
    expect(read()).toBe('04:12')
  })

  it('swallows the colon without changing anything', () => {
    const { press, read } = harness('04:12')
    expect(press(':')).toHaveBeenCalled()
    expect(press('a')).toHaveBeenCalled()
    expect(read()).toBe('04:12')
  })

  it('lets navigation keys through untouched', () => {
    const { press, read } = harness('04:12')
    const intercepted = ['Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End']
      .filter((key) => press(key).mock.calls.length > 0)
    expect(intercepted).toEqual([])
    expect(read()).toBe('04:12')
  })

  // Ctrl/Cmd+A and friends still belong to the browser.
  it('never intercepts a shortcut', () => {
    const { press, read } = harness('04:12')
    expect(press('a', 0, { metaKey: true })).not.toHaveBeenCalled()
    expect(press('4', 0, { ctrlKey: true })).not.toHaveBeenCalled()
    expect(read()).toBe('04:12')
  })

  it('backspaces by shifting right', () => {
    const { press, read } = harness('04:12')
    press('Backspace')
    expect(read()).toBe('00:41')
    press('Delete')
    expect(read()).toBe('00:04')
  })

  it('nudges the half the caret sits in', () => {
    const { press, read } = harness('04:12')
    press('ArrowUp', 1)
    expect(read()).toBe('05:12')
    press('ArrowDown', 4)
    expect(read()).toBe('05:11')
  })

  // A moment needs a clock — one without a time is not a moment — so its
  // field is always MM:SS with nothing to clear.
  it('bottoms out at 00:00 when the field cannot be empty', () => {
    const { press, read } = harness('00:00')
    press('Backspace')
    expect(read()).toBe('00:00')
  })

  // A note's clock is optional: "somewhere in this game" is a real thing for
  // a coach to mean, so there has to be a way back to no clock at all.
  it('gives back no clock at all when the field is clearable', () => {
    const { press, read } = harness('00:04', { clearable: true })
    press('Backspace')
    expect(read()).toBe('00:00')
    press('Backspace')
    expect(read()).toBe('')
  })

  it('starts a clearable field from 00:00 on the first digit', () => {
    const { press, read } = harness('', { clearable: true })
    press('7')
    expect(read()).toBe('00:07')
  })
})
