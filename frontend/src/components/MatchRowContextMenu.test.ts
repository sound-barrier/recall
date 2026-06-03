import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'

import MatchRowContextMenu from './MatchRowContextMenu.vue'

const wrappers: VueWrapper[] = []
function mountMenu(props: {
  position: { x: number; y: number } | null
  matchKey?: string
  isAnchor?: boolean
}) {
  const w = mount(MatchRowContextMenu, {
    props: {
      matchKey: props.matchKey ?? 'm1',
      isAnchor: props.isAnchor ?? false,
      ...props,
    },
    attachTo: document.body,
  })
  wrappers.push(w)
  return w
}

describe('MatchRowContextMenu', () => {
  afterEach(() => {
    while (wrappers.length) wrappers.pop()!.unmount()
  })

  it('renders nothing when position is null', () => {
    mountMenu({ position: null })
    expect(document.body.querySelector('[data-row-ctx]')).toBeNull()
  })

  it('renders the menu at the supplied (x, y) coordinates', () => {
    mountMenu({ position: { x: 100, y: 200 } })
    const menu = document.body.querySelector('[data-row-ctx]') as HTMLElement
    expect(menu).not.toBeNull()
    expect(menu.style.left).toBe('100px')
    expect(menu.style.top).toBe('200px')
  })

  it('shows "Filter from this match" when the row is NOT the anchor', () => {
    mountMenu({ position: { x: 0, y: 0 }, isAnchor: false })
    const menu = document.body.querySelector('[data-row-ctx]')!
    expect(menu.textContent).toMatch(/filter from this match/i)
    expect(menu.textContent).not.toMatch(/clear.*anchor/i)
  })

  it('shows "Clear since-anchor" when the row IS the anchor', () => {
    mountMenu({ position: { x: 0, y: 0 }, isAnchor: true })
    const menu = document.body.querySelector('[data-row-ctx]')!
    expect(menu.textContent).toMatch(/clear.*anchor/i)
  })

  it('clicking "Open detail" emits open-detail(matchKey) + close', () => {
    const w = mountMenu({ position: { x: 0, y: 0 }, matchKey: 'match-A' })
    const btn = document.body.querySelector('[data-row-ctx-open]') as HTMLButtonElement
    btn.click()
    expect(w.emitted('open-detail')).toBeTruthy()
    expect(w.emitted('open-detail')![0]).toEqual(['match-A'])
    expect(w.emitted('close')).toBeTruthy()
  })

  it('clicking the anchor item emits set-anchor(matchKey) + close when idle', () => {
    const w = mountMenu({ position: { x: 0, y: 0 }, matchKey: 'match-B', isAnchor: false })
    const btn = document.body.querySelector('[data-row-ctx-anchor]') as HTMLButtonElement
    btn.click()
    expect(w.emitted('set-anchor')).toBeTruthy()
    expect(w.emitted('set-anchor')![0]).toEqual(['match-B'])
    expect(w.emitted('close')).toBeTruthy()
  })

  it('clicking the anchor item emits set-anchor("") + close when active', () => {
    const w = mountMenu({ position: { x: 0, y: 0 }, matchKey: 'match-C', isAnchor: true })
    const btn = document.body.querySelector('[data-row-ctx-anchor]') as HTMLButtonElement
    btn.click()
    expect(w.emitted('set-anchor')![0]).toEqual([''])
  })

  it('pressing Escape emits close', async () => {
    const w = mountMenu({ position: { x: 0, y: 0 } })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('close')).toBeTruthy()
  })

  it('click outside the menu emits close', () => {
    const w = mountMenu({ position: { x: 0, y: 0 } })
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    outside.click()
    expect(w.emitted('close')).toBeTruthy()
    document.body.removeChild(outside)
  })
})
