import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'

import MatchRowContextMenu from '@/components/matches/list/MatchRowContextMenu.vue'

// The write gate reads the profiles query + the coaching-session store;
// these cases pin this component's own contract, so stub it open.
vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))

// The menu teleports to <body> as a role="menu", so queries run
// through screen (document-scoped) rather than the container.
function renderMenu(props: {
  position: { x: number; y: number } | null
  matchKey?: string
  isAnchor?: boolean
}) {
  return render(MatchRowContextMenu, {
    props: {
      matchKey: props.matchKey ?? 'm1',
      isAnchor: props.isAnchor ?? false,
      ...props,
    },
  })
}

describe('MatchRowContextMenu', () => {
  it('renders nothing when position is null', () => {
    renderMenu({ position: null })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  // The one style assertion that survives: this menu's whole contract at
  // (x, y) IS the paint — a fixed-position popover has no text, name, or
  // ARIA state that says where it landed, and the clamp math it exercises
  // is only observable as left/top.
  it('renders the menu at the supplied (x, y) coordinates', () => {
    renderMenu({ position: { x: 100, y: 200 } })
    const menu = screen.getByRole('menu')
    // eslint-disable-next-line no-restricted-syntax -- a fixed-position popover has no ARIA for WHERE it landed; left/top IS the clamp contract
    expect(menu).toHaveStyle({ left: '100px', top: '200px' })
  })

  it('shows "Filter from this match" when the row is NOT the anchor', () => {
    renderMenu({ position: { x: 0, y: 0 }, isAnchor: false })
    expect(screen.getByRole('menuitem', { name: 'Filter from this match' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /clear.*anchor/i })).not.toBeInTheDocument()
  })

  it('shows "Clear since-anchor" when the row IS the anchor', () => {
    renderMenu({ position: { x: 0, y: 0 }, isAnchor: true })
    expect(screen.getByRole('menuitem', { name: 'Clear since-anchor' })).toBeInTheDocument()
  })

  it('clicking "Open detail" emits open-detail(matchKey) + close', async () => {
    const user = userEvent.setup()
    const { emitted } = renderMenu({ position: { x: 0, y: 0 }, matchKey: 'match-A' })
    await user.click(screen.getByRole('menuitem', { name: 'Open detail' }))
    expect(emitted('open-detail')).toBeTruthy()
    expect(emitted('open-detail')[0]).toEqual(['match-A'])
    expect(emitted('close')).toBeTruthy()
  })

  it('clicking the anchor item emits set-anchor(matchKey) + close when idle', async () => {
    const user = userEvent.setup()
    const { emitted } = renderMenu({ position: { x: 0, y: 0 }, matchKey: 'match-B', isAnchor: false })
    await user.click(screen.getByRole('menuitem', { name: 'Filter from this match' }))
    expect(emitted('set-anchor')).toBeTruthy()
    expect(emitted('set-anchor')[0]).toEqual(['match-B'])
    expect(emitted('close')).toBeTruthy()
  })

  it('clicking the anchor item emits set-anchor("") + close when active', async () => {
    const user = userEvent.setup()
    const { emitted } = renderMenu({ position: { x: 0, y: 0 }, matchKey: 'match-C', isAnchor: true })
    await user.click(screen.getByRole('menuitem', { name: 'Clear since-anchor' }))
    expect(emitted('set-anchor')[0]).toEqual([''])
  })

  it('pressing Escape emits close', async () => {
    const { emitted } = renderMenu({ position: { x: 0, y: 0 } })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(emitted('close')).toBeTruthy()
  })

  it('click outside the menu emits close', async () => {
    const user = userEvent.setup()
    const { emitted } = renderMenu({ position: { x: 0, y: 0 } })
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    await user.click(outside)
    expect(emitted('close')).toBeTruthy()
    outside.remove()
  })

  it('renders the "Hide match" item', () => {
    renderMenu({ position: { x: 0, y: 0 } })
    expect(screen.getByRole('menuitem', { name: 'Hide match' })).toBeInTheDocument()
  })

  it('clicking "Hide match" emits hide(matchKey) + close', async () => {
    const user = userEvent.setup()
    const { emitted } = renderMenu({ position: { x: 0, y: 0 }, matchKey: 'match-D' })
    await user.click(screen.getByRole('menuitem', { name: 'Hide match' }))
    expect(emitted('hide')).toBeTruthy()
    expect(emitted('hide')[0]).toEqual(['match-D'])
    expect(emitted('close')).toBeTruthy()
  })
})
