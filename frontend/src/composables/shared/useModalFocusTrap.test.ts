import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { useModalFocusTrap } from '@/composables/shared/useModalFocusTrap'

function buildModalDOM() {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild)
  const trigger = document.createElement('button')
  trigger.id = 'trigger'
  trigger.textContent = 'Open Modal'
  document.body.appendChild(trigger)

  const box = document.createElement('div')
  box.className = 'modal-box'
  const cancel = document.createElement('button')
  cancel.id = 'cancel'
  cancel.textContent = 'Cancel'
  const confirm = document.createElement('button')
  confirm.id = 'confirm'
  confirm.textContent = 'Continue'
  box.appendChild(cancel)
  box.appendChild(confirm)
  document.body.appendChild(box)

  return { trigger, cancel, confirm, box }
}

describe('useModalFocusTrap', () => {
  beforeEach(() => { buildModalDOM() })

  afterEach(() => {
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild)
    vi.restoreAllMocks()
  })

  it('moves focus to the first focusable inside the container on open', async () => {
    const open = ref(false)
    const { cancel } = buildModalDOM()
    useModalFocusTrap(open, { containerSelector: '.modal-box' })
    const focusSpy = vi.spyOn(cancel, 'focus')
    open.value = true
    await nextTick()
    await nextTick()
    expect(focusSpy).toHaveBeenCalled()
  })

  it('Escape sets open to false when no onClose callback is provided', async () => {
    const open = ref(false)
    useModalFocusTrap(open, { containerSelector: '.modal-box' })
    open.value = true
    await nextTick()
    const ev = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    document.dispatchEvent(ev)
    expect(open.value).toBe(false)
  })

  // Caller-owned open ref: useModalFocusTrap mutates open.value.
  // Prop-derived open ref: writes through the toRef proxy are local-
  // only and don't bubble back to the parent — caller passes onClose
  // so Esc fires the emit('close') path instead. This test pins the
  // contract used by KeyboardShortcutsModal.
  it('Escape invokes onClose and does NOT mutate open when callback provided', async () => {
    const open = ref(false)
    const onClose = vi.fn()
    useModalFocusTrap(open, { containerSelector: '.modal-box', onClose })
    open.value = true
    await nextTick()
    const ev = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    document.dispatchEvent(ev)
    expect(onClose).toHaveBeenCalledTimes(1)
    // open ref is untouched — the parent's @close handler owns the close.
    expect(open.value).toBe(true)
  })

  it('Tab from the last focusable wraps to the first', async () => {
    const open = ref(false)
    const { cancel, confirm } = buildModalDOM()
    useModalFocusTrap(open, { containerSelector: '.modal-box' })
    open.value = true
    await nextTick()
    confirm.focus()
    const focusSpy = vi.spyOn(cancel, 'focus')
    const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false, cancelable: true })
    const prevented = vi.spyOn(ev, 'preventDefault')
    document.dispatchEvent(ev)
    expect(prevented).toHaveBeenCalled()
    expect(focusSpy).toHaveBeenCalled()
  })

  it('Shift+Tab from the first focusable wraps to the last', async () => {
    const open = ref(false)
    const { cancel, confirm } = buildModalDOM()
    useModalFocusTrap(open, { containerSelector: '.modal-box' })
    open.value = true
    await nextTick()
    cancel.focus()
    const focusSpy = vi.spyOn(confirm, 'focus')
    const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true })
    const prevented = vi.spyOn(ev, 'preventDefault')
    document.dispatchEvent(ev)
    expect(prevented).toHaveBeenCalled()
    expect(focusSpy).toHaveBeenCalled()
  })

  it('Tab in the middle of the ring does not preventDefault (browser handles it)', async () => {
    // Add a third focusable so there's a "middle" element.
    const open = ref(false)
    const { confirm, box } = buildModalDOM()
    const link = document.createElement('a')
    link.href = '#'
    link.id = 'link'
    box.appendChild(link)
    useModalFocusTrap(open, { containerSelector: '.modal-box' })
    open.value = true
    await nextTick()
    confirm.focus()
    const ev = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })
    const prevented = vi.spyOn(ev, 'preventDefault')
    document.dispatchEvent(ev)
    expect(prevented).not.toHaveBeenCalled()
  })

  it('non-Tab / non-Escape keys are ignored', async () => {
    const open = ref(true)
    useModalFocusTrap(open, { containerSelector: '.modal-box' })
    await nextTick()
    const ev = new KeyboardEvent('keydown', { key: 'a', cancelable: true })
    const prevented = vi.spyOn(ev, 'preventDefault')
    document.dispatchEvent(ev)
    expect(prevented).not.toHaveBeenCalled()
    expect(open.value).toBe(true)
  })

  it('returns focus to the trigger when closed', async () => {
    const open = ref(false)
    const { trigger } = buildModalDOM()
    useModalFocusTrap(open, { containerSelector: '.modal-box' })
    trigger.focus()
    open.value = true
    await nextTick()
    await nextTick()
    // The composable should remember the trigger; closing should
    // refocus it.
    const restoreSpy = vi.spyOn(trigger, 'focus')
    open.value = false
    await nextTick()
    await nextTick()
    expect(restoreSpy).toHaveBeenCalled()
  })

  it('removes the document listener when closed', async () => {
    const open = ref(false)
    useModalFocusTrap(open, { containerSelector: '.modal-box' })
    open.value = true
    await nextTick()
    open.value = false
    await nextTick()
    // Dispatching Escape after close should not flip open back.
    open.value = true // re-arm to detect "no, listener really is gone"
    await nextTick()
    // Now close, then verify the listener really detached:
    open.value = false
    await nextTick()
    await nextTick()
    const ev = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    document.dispatchEvent(ev)
    expect(open.value).toBe(false)
  })

  it('no-op when container selector matches nothing', async () => {
    const open = ref(false)
    useModalFocusTrap(open, { containerSelector: '.does-not-exist' })
    open.value = true
    await nextTick()
    // Should not throw; Tab event with no focusable bag falls through.
    const ev = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })
    const prevented = vi.spyOn(ev, 'preventDefault')
    document.dispatchEvent(ev)
    expect(prevented).not.toHaveBeenCalled()
  })

  describe('keepOpenOnFieldEscape', () => {
    it('Escape in a text field deselects it without closing when opted in', async () => {
      const open = ref(false)
      const onClose = vi.fn()
      useModalFocusTrap(open, { containerSelector: '.modal-box', onClose, keepOpenOnFieldEscape: true })
      const input = document.createElement('input')
      document.querySelector('.modal-box')!.appendChild(input)
      open.value = true
      await nextTick()
      input.focus()
      const blurSpy = vi.spyOn(input, 'blur')
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
      expect(onClose).not.toHaveBeenCalled()
      expect(blurSpy).toHaveBeenCalled()
    })

    it('Escape outside a field still closes when opted in', async () => {
      const open = ref(false)
      const onClose = vi.fn()
      useModalFocusTrap(open, { containerSelector: '.modal-box', onClose, keepOpenOnFieldEscape: true })
      open.value = true
      await nextTick()
      ;(document.querySelector('#cancel') as HTMLElement).focus()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('Escape in a field still closes when NOT opted in (default)', async () => {
      const open = ref(false)
      const onClose = vi.fn()
      useModalFocusTrap(open, { containerSelector: '.modal-box', onClose })
      const input = document.createElement('input')
      document.querySelector('.modal-box')!.appendChild(input)
      open.value = true
      await nextTick()
      input.focus()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
