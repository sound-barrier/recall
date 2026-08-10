import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import DashboardWidget from '@/components/dashboard/DashboardWidget.vue'

// The widget shell's data-* attributes (data-widget-id, data-kpi,
// data-breakdown, draggable) ARE the contract under test — the drag
// engine and the e2e specs select on them — so the structural
// assertions below reach for baseElement.querySelector deliberately.
// Same for the shape/drag-state classes: the CSS family a widget lands
// in and its mid-drag visual state have no ARIA expression at all.
/* eslint-disable testing-library/no-node-access -- data-attr shell contract consumed by the drag engine + e2e selectors */

describe('DashboardWidget', () => {
  it('renders a <div class="kpi-tile"> for shape=kpi with data-widget-id', () => {
    const { baseElement } = render(DashboardWidget, {
      props: { id: 'winrate', shape: 'kpi' },
      slots: { default: '<span class="payload">x</span>' },
    })
    const root = baseElement.querySelector('[data-widget-id="winrate"]')
    expect(root).not.toBeNull()
    expect(root!.tagName).toBe('DIV')
    // eslint-disable-next-line no-restricted-syntax -- the kpi/breakdown shape class IS the CSS shell contract; no ARIA equivalent
    expect(root).toHaveClass('kpi-tile')
    expect(screen.getByText('x')).toBeInTheDocument()
  })

  it('renders an <article class="breakdown"> for shape=breakdown', () => {
    render(DashboardWidget, {
      props: { id: 'top-maps', shape: 'breakdown' },
    })
    const root = screen.getByRole('article')
    // eslint-disable-next-line no-restricted-syntax -- data-widget-id is the drag engine's runtime lookup key
    expect(root).toHaveAttribute('data-widget-id', 'top-maps')
    // eslint-disable-next-line no-restricted-syntax -- the kpi/breakdown shape class IS the CSS shell contract; no ARIA equivalent
    expect(root).toHaveClass('breakdown')
  })

  it('emits the legacy data-kpi attr when legacyDataKpi is set', () => {
    const { baseElement } = render(DashboardWidget, {
      props: { id: 'reviewed-count', shape: 'kpi', legacyDataKpi: 'reviewed-count' },
    })
    expect(baseElement.querySelector('[data-kpi="reviewed-count"]')).not.toBeNull()
    expect(baseElement.querySelector('[data-widget-id="reviewed-count"]')).not.toBeNull()
  })

  it('omits data-kpi when legacyDataKpi is unset', () => {
    const { baseElement } = render(DashboardWidget, {
      props: { id: 'winrate', shape: 'kpi' },
    })
    expect(baseElement.querySelector('[data-kpi]')).toBeNull()
  })

  it('emits the legacy data-breakdown attr when legacyDataBreakdown is set', () => {
    const { baseElement } = render(DashboardWidget, {
      props: { id: 'top-roles', shape: 'breakdown', legacyDataBreakdown: 'roles' },
    })
    expect(baseElement.querySelector('[data-breakdown="roles"]')).not.toBeNull()
  })

  // No edit mode: the drag handle + trash are ALWAYS in the DOM (CSS
  // hover-reveals them), so manage controls are one gesture away with
  // no mode to enter first.
  it('always renders the drag handle and trash button', () => {
    render(DashboardWidget, { props: { id: 'winrate', shape: 'kpi' } })
    expect(screen.getByRole('button', { name: /Reorder widget winrate/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove widget winrate from the dashboard' })).toBeInTheDocument()
  })

  it('is draggable so reorder works without a mode', () => {
    const { baseElement } = render(DashboardWidget, { props: { id: 'winrate', shape: 'kpi' } })
    expect(baseElement.querySelector('[data-widget-id="winrate"]')).toHaveAttribute('draggable', 'true')
  })

  it('clicking the trash button emits remove(id)', async () => {
    const user = userEvent.setup()
    const { emitted } = render(DashboardWidget, { props: { id: 'winrate', shape: 'kpi' } })
    await user.click(screen.getByRole('button', { name: 'Remove widget winrate from the dashboard' }))
    expect(emitted('remove')).toBeTruthy()
    expect(emitted('remove')[0]).toEqual(['winrate'])
  })

  it('applies dashboard-widget-dragging when the dragging prop flips', async () => {
    const { baseElement, rerender } = render(DashboardWidget, {
      props: { id: 'winrate', shape: 'kpi', dragging: false },
    })
    const root = baseElement.querySelector('[data-widget-id="winrate"]')
    // eslint-disable-next-line no-restricted-syntax -- mid-drag visual state; ARIA retired aria-grabbed and has no replacement
    expect(root).not.toHaveClass('dashboard-widget-dragging')
    await rerender({ dragging: true })
    // eslint-disable-next-line no-restricted-syntax -- mid-drag visual state; ARIA retired aria-grabbed and has no replacement
    expect(root).toHaveClass('dashboard-widget-dragging')
  })

  it('applies dashboard-widget-drop-target when dropTarget flips', async () => {
    const { baseElement, rerender } = render(DashboardWidget, {
      props: { id: 'winrate', shape: 'kpi', dropTarget: false },
    })
    const root = baseElement.querySelector('[data-widget-id="winrate"]')
    // eslint-disable-next-line no-restricted-syntax -- drop-target highlight is a drag-engine visual; ARIA has no dropeffect replacement
    expect(root).not.toHaveClass('dashboard-widget-drop-target')
    await rerender({ dropTarget: true })
    // eslint-disable-next-line no-restricted-syntax -- drop-target highlight is a drag-engine visual; ARIA has no dropeffect replacement
    expect(root).toHaveClass('dashboard-widget-drop-target')
  })

  // The gear is gated only by a non-empty config schema (hasConfig) —
  // settings are a read-time concern, independent of layout edits.
  it('renders the gear button only when hasConfig is true', async () => {
    const { rerender } = render(DashboardWidget, {
      props: { id: 'top-heroes', shape: 'breakdown', hasConfig: true },
    })
    expect(screen.getByRole('button', { name: 'Configure widget top-heroes' })).toBeInTheDocument()
    await rerender({ hasConfig: false })
    expect(screen.queryByRole('button', { name: 'Configure widget top-heroes' })).not.toBeInTheDocument()
  })

  it('clicking the gear emits configure(id, event)', async () => {
    const user = userEvent.setup()
    const { emitted } = render(DashboardWidget, {
      props: { id: 'top-heroes', shape: 'breakdown', hasConfig: true },
    })
    await user.click(screen.getByRole('button', { name: 'Configure widget top-heroes' }))
    const configure = emitted<unknown[]>('configure')
    expect(configure).toBeTruthy()
    expect(configure[0]![0]).toBe('top-heroes')
  })

  it('forwards handle keydown for keyboard reorder', async () => {
    const { emitted } = render(DashboardWidget, {
      props: { id: 'winrate', shape: 'kpi', row: 1, idx: 0 },
    })
    await fireEvent.keyDown(screen.getByRole('button', { name: /Reorder widget winrate/ }), { key: 'ArrowRight' })
    const handleKeydown = emitted<unknown[]>('handle-keydown')
    expect(handleKeydown).toBeTruthy()
    expect(handleKeydown[0]![0]).toBe('winrate')
  })
})
