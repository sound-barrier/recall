import { render, screen, fireEvent } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import KeyboardShortcutsModal from '@/components/shared/KeyboardShortcutsModal.vue'
import type { ViewId } from '@/composables/shared/useTabKeyboardNav'

interface ModalProps {
  open?: boolean
  view?: ViewId
  panelOpen?: boolean
}

function renderCheatsheet(props: ModalProps = {}) {
  return render(KeyboardShortcutsModal, {
    props: { open: true, view: 'matches', panelOpen: false, ...props },
  })
}

const teardown: (() => void)[] = []

// A stand-in for the app's own global dispatcher, which sits on document
// at capture phase. Registered AFTER the modal so the modal's listener
// gets first refusal — exactly the production ordering.
function shortcutsBehindTheModal(): string[] {
  const seen: string[] = []
  const handler = (e: KeyboardEvent) => { seen.push(e.key) }
  document.addEventListener('keydown', handler, true)
  teardown.push(() => document.removeEventListener('keydown', handler, true))
  return seen
}

function press(key: string, init: KeyboardEventInit = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

const groupHeading = (name: string) => screen.queryByRole('heading', { name })

afterEach(() => {
  for (const undo of teardown.splice(0)) undo()
  vi.unstubAllGlobals()
})

describe('KeyboardShortcutsModal — context gating', () => {
  it('lists the Matches bindings and hides the panel scopes while no panel is open', () => {
    renderCheatsheet({ view: 'matches', panelOpen: false })

    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
    expect(groupHeading('Matches view')).toBeInTheDocument()
    expect(groupHeading('Global')).toBeInTheDocument()
    // j / k belong to the list while the panel is shut; advertising the
    // panel's own bindings here would be a lie.
    expect(groupHeading('Detail panel')).not.toBeInTheDocument()
    expect(groupHeading('Screenshots (in the fullscreen lightbox)')).not.toBeInTheDocument()
  })

  // The film room is a view without a tab: its reel bindings are only
  // reachable during a coaching session, so the group only shows there.
  it('surfaces the film-room bindings in the room, and nowhere else', () => {
    const view = renderCheatsheet({ view: 'coach' })
    expect(groupHeading('Film room')).toBeInTheDocument()
    view.unmount()

    renderCheatsheet({ view: 'matches' })
    expect(groupHeading('Film room')).not.toBeInTheDocument()
  })

  it('flips to the detail-panel scopes once the panel takes the keyboard', () => {
    renderCheatsheet({ view: 'matches', panelOpen: true })

    expect(groupHeading('Detail panel')).toBeInTheDocument()
    expect(groupHeading('Screenshots (in the fullscreen lightbox)')).toBeInTheDocument()
    expect(groupHeading('Matches view')).not.toBeInTheDocument()
    expect(groupHeading('Narrow panel (filters)')).not.toBeInTheDocument()
  })

  it('shows only the always-on scopes on a view with no bindings of its own', () => {
    renderCheatsheet({ view: 'settings', panelOpen: false })

    expect(groupHeading('Global')).toBeInTheDocument()
    expect(groupHeading('Tablist + modals')).toBeInTheDocument()
    expect(groupHeading('Matches view')).not.toBeInTheDocument()
  })
})

describe('KeyboardShortcutsModal — keyboard ownership', () => {
  it('closes on Escape without the modal underneath also seeing it', () => {
    const view = renderCheatsheet()
    const behind = shortcutsBehindTheModal()

    press('Escape')

    expect(view.emitted('close')).toBeTruthy()
    // One Esc dismisses the cheatsheet only — not the detail panel it
    // may be stacked over.
    expect(behind).not.toContain('Escape')
  })

  it('swallows app shortcuts so nothing happens behind it', () => {
    renderCheatsheet()
    const behind = shortcutsBehindTheModal()

    press('g')
    press('/')
    press('e')

    expect(behind).toEqual([])
  })

  it('lets Tab and modified keys through for the focus trap and the browser', () => {
    renderCheatsheet()
    const behind = shortcutsBehindTheModal()

    press('Tab')
    press('Shift')
    press('r', { ctrlKey: true })
    press('w', { metaKey: true })

    expect(behind).toEqual(['Tab', 'Shift', 'r', 'w'])
  })

  it('scrolls its own body with j / k', async () => {
    renderCheatsheet()
    // eslint-disable-next-line testing-library/no-node-access -- the scroll container is the modal's own element ref, not an accessible control
    const box = document.querySelector('.kbd-modal-box') as HTMLElement
    Object.defineProperty(box, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(box, 'clientHeight', { value: 200, configurable: true })
    // Reduced motion makes the momentum scroller snap instead of tweening
    // across animation frames.
    vi.stubGlobal('matchMedia', () => ({ matches: true }))

    press('j')
    press('ArrowDown')
    await Promise.resolve()
    expect(box.scrollTop).toBe(100)

    press('k')
    press('ArrowUp')
    await Promise.resolve()
    expect(box.scrollTop).toBe(0)
  })
})

describe('KeyboardShortcutsModal — lifecycle', () => {
  it('does not eat keys while it is mounted but closed', () => {
    // The cheatsheet is a lazy-loaded chunk that stays mounted after the
    // first open — a swallow that ignored `open` would kill every global
    // shortcut for the rest of the session.
    renderCheatsheet({ open: false })
    const behind = shortcutsBehindTheModal()

    press('g')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(behind).toEqual(['g'])
  })

  it('releases the document listener when it unmounts', () => {
    const view = renderCheatsheet()
    const behind = shortcutsBehindTheModal()

    view.unmount()
    press('g')

    expect(behind).toEqual(['g'])
  })
})

describe('KeyboardShortcutsModal — pointer dismissal', () => {
  it('closes on a backdrop click but stays open when the sheet itself is clicked', async () => {
    const view = renderCheatsheet()

    await fireEvent.click(screen.getByRole('heading', { name: 'Keyboard shortcuts' }))
    expect(view.emitted('close')).toBeFalsy()

    await fireEvent.click(screen.getByRole('dialog', { name: 'Keyboard shortcuts' }))
    expect(view.emitted('close')).toBeTruthy()
  })

  it('closes from the footer button', async () => {
    const view = renderCheatsheet()

    await fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(view.emitted('close')).toBeTruthy()
  })
})
