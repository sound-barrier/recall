import { render, screen, fireEvent } from '@testing-library/vue'
import { describe, it, expect, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'

import { useCoachReelKeyboard } from '@/composables/coach/useCoachReelKeyboard'

const KEYS = ['frame-a', 'frame-b', 'frame-c']

// A stand-in reel: one button per frame, keyed the way CoachReelFrame
// keys its own button so the composable can move focus.
function mountReel(activeKey = 'frame-a') {
  const select = vi.fn()
  const active = ref(activeKey)
  const view = render(defineComponent({
    setup() {
      const reel = ref<HTMLElement | null>(null)
      const { onReelKeydown } = useCoachReelKeyboard({
        keys: KEYS,
        activeKey: active,
        select: (key: string) => {
          active.value = key
          select(key)
        },
        reel,
      })
      return () => h('ol', { ref: reel, 'aria-label': 'frames', onKeydown: onReelKeydown },
        KEYS.map((key) => h('li', { key }, [h('button', { type: 'button', 'data-match-key': key }, key)])))
    },
  }))
  return { select, view, reel: screen.getByRole('list', { name: 'frames' }) }
}

function pressOnDocument(key: string, init: KeyboardEventInit = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

describe('useCoachReelKeyboard — inside the reel', () => {
  it('ArrowDown and j step to the next frame', async () => {
    const { select, reel } = mountReel()
    await fireEvent.keyDown(reel, { key: 'ArrowDown' })
    expect(select).toHaveBeenLastCalledWith('frame-b')
    await fireEvent.keyDown(reel, { key: 'j' })
    expect(select).toHaveBeenLastCalledWith('frame-c')
  })

  it('ArrowUp and k step back', async () => {
    const { select, reel } = mountReel('frame-c')
    await fireEvent.keyDown(reel, { key: 'ArrowUp' })
    expect(select).toHaveBeenLastCalledWith('frame-b')
    await fireEvent.keyDown(reel, { key: 'k' })
    expect(select).toHaveBeenLastCalledWith('frame-a')
  })

  it('Home and End jump to the ends', async () => {
    const { select, reel } = mountReel('frame-b')
    await fireEvent.keyDown(reel, { key: 'End' })
    expect(select).toHaveBeenLastCalledWith('frame-c')
    await fireEvent.keyDown(reel, { key: 'Home' })
    expect(select).toHaveBeenLastCalledWith('frame-a')
  })

  it('stops at the ends rather than wrapping', async () => {
    const { select, reel } = mountReel('frame-a')
    await fireEvent.keyDown(reel, { key: 'ArrowUp' })
    expect(select).not.toHaveBeenCalled()
  })

  it('leaves keys it does not own alone', () => {
    const { select, reel } = mountReel()
    const typed = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    reel.dispatchEvent(typed)
    expect(select).not.toHaveBeenCalled()
    expect(typed.defaultPrevented).toBe(false)
  })

  it('claims the keys it does own', () => {
    const { reel } = mountReel()
    const stepped = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    reel.dispatchEvent(stepped)
    expect(stepped.defaultPrevented).toBe(true)
  })

  it('moves focus onto the frame it selected', async () => {
    const { reel } = mountReel()
    await fireEvent.keyDown(reel, { key: 'ArrowDown' })
    await nextTick()
    expect(document.activeElement?.textContent).toBe('frame-b')
  })
})

describe('useCoachReelKeyboard — the bracket keys', () => {
  it('] steps forward and [ steps back from anywhere on the page', () => {
    const { select } = mountReel('frame-b')
    pressOnDocument(']')
    expect(select).toHaveBeenLastCalledWith('frame-c')
    pressOnDocument('[')
    expect(select).toHaveBeenLastCalledWith('frame-b')
  })

  it('ignores a bracket typed into a text field', async () => {
    const { select } = mountReel()
    const input = document.createElement('textarea')
    document.body.appendChild(input)
    input.focus()
    await fireEvent.keyDown(input, { key: ']' })
    expect(select).not.toHaveBeenCalled()
    input.remove()
  })

  it('ignores a bracket pressed with a modifier held', () => {
    const { select } = mountReel()
    pressOnDocument(']', { metaKey: true })
    expect(select).not.toHaveBeenCalled()
  })

  it('stops listening once the room unmounts', () => {
    const { select, view } = mountReel()
    view.unmount()
    pressOnDocument(']')
    expect(select).not.toHaveBeenCalled()
  })
})
