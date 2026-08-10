import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/vue'

import PivotFieldChip, {
  type ChipAction,
  type FilterOption,
} from '@/components/matches/pivot/PivotFieldChip.vue'

// HTML5 drag-and-drop isn't keyboard-operable, so the chip's press-to-open
// menu is the ACCESSIBLE primary path for every move a drag can make. These
// tests drive that path: the menu's ARIA contract, the model-driven filter
// ticks (a native <input> once desynced and left the box visually stuck),
// dismissal, and the drag payload both sides of the chip↔table seam parse.

const DIM_ACTIONS: ChipAction[] = [
  { label: 'Move to Columns', payload: { type: 'assign', zone: 'columns' } },
  { label: 'Remove', payload: { type: 'remove' } },
]

const MAP_OPTIONS: FilterOption[] = [
  { value: 'busan', checked: true },
  { value: 'rialto', checked: true },
]

function renderChip(props: Record<string, unknown> = {}) {
  return render(PivotFieldChip, {
    props: { fieldId: 'hero', label: 'Hero', location: 'rows', actions: DIM_ACTIONS, ...props },
  })
}

const menuItems = () => screen.getAllByRole('menuitem').map((i) => i.textContent?.trim())

describe('PivotFieldChip — menu contract', () => {
  it('opens its move menu on press, reports it in aria-expanded, and closes on Escape', async () => {
    renderChip()
    const chip = screen.getByRole('button', { name: 'Hero' })
    expect(chip).toHaveAttribute('aria-haspopup', 'menu')
    expect(chip).toHaveAttribute('aria-expanded', 'false')

    await fireEvent.click(chip)
    expect(chip).toHaveAttribute('aria-expanded', 'true')
    expect(menuItems()).toEqual(['Move to Columns', 'Remove'])

    await fireEvent.keyDown(chip, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(chip).toHaveAttribute('aria-expanded', 'false')
  })

  it('moves focus onto the first item so the menu is reachable by keyboard alone', async () => {
    renderChip()
    await fireEvent.click(screen.getByRole('button', { name: 'Hero' }))
    expect(screen.getByRole('menuitem', { name: 'Move to Columns' })).toHaveFocus()
  })

  it('offers no menu at all when the chip has no actions and no filter values', async () => {
    renderChip({ actions: [] })
    const chip = screen.getByRole('button', { name: 'Hero' })
    // No popup is advertised, and pressing must not open an empty panel.
    expect(chip).not.toHaveAttribute('aria-haspopup')
    expect(chip).not.toHaveAttribute('aria-expanded')
    await fireEvent.click(chip)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('emits the chosen action, dismisses the menu, and hands focus back to the chip', async () => {
    const { emitted } = renderChip()
    const chip = screen.getByRole('button', { name: 'Hero' })
    await fireEvent.click(chip)
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Columns' }))

    expect(emitted('act')).toEqual([[{ type: 'assign', zone: 'columns' }]])
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(chip).toHaveFocus()
  })

  it('names a value chip with its aggregation so the shelf reads unambiguously', () => {
    renderChip({ fieldId: 'damage', label: 'Damage', location: 'values', index: 1, aggLabel: 'Average' })
    // Two Damage chips can sit on the Values shelf at once; only the agg
    // badge tells them apart, so it has to be part of the accessible name.
    expect(screen.getByRole('button', { name: 'Damage Average' })).toBeInTheDocument()
  })
})

describe('PivotFieldChip — filter value checklist', () => {
  async function openFilterChip() {
    const view = renderChip({ location: 'filters', label: 'Map', fieldId: 'map', filterOptions: MAP_OPTIONS })
    await fireEvent.click(screen.getByRole('button', { name: 'Map' }))
    return view
  }

  it('drives each tick from the parent model and keeps the menu open across toggles', async () => {
    const { emitted, rerender } = await openFilterChip()
    expect(screen.getByText('2 of 2 shown')).toBeInTheDocument()

    const busan = () => screen.getByRole('menuitemcheckbox', { name: 'busan' })
    expect(busan()).toHaveAttribute('aria-checked', 'true')

    await fireEvent.click(busan())
    expect(emitted('act')).toEqual([[{ type: 'toggleFilter', value: 'busan' }]])
    // The tick is NOT self-managed: until the parent re-issues the options
    // it stays as it was, and the menu must survive so a user can flip
    // several values in a row without re-opening it.
    expect(busan()).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await rerender({ filterOptions: [{ value: 'busan', checked: false }, { value: 'rialto', checked: true }] })
    expect(busan()).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('1 of 2 shown')).toBeInTheDocument()
  })

  it('offers an All reset that re-includes every value without closing the menu', async () => {
    const { emitted } = await openFilterChip()
    await fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(emitted('act')).toEqual([[{ type: 'filterReset' }]])
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('opens a checklist-only menu when the chip carries values but no move actions', async () => {
    renderChip({
      location: 'filters',
      label: 'Map',
      fieldId: 'map',
      actions: [],
      filterOptions: [{ value: 'busan', checked: false }, { value: 'rialto', checked: false }],
    })
    const chip = screen.getByRole('button', { name: 'Map' })
    // Values alone are enough to earn a popup — the menu isn't gated on
    // having move actions.
    expect(chip).toHaveAttribute('aria-haspopup', 'menu')
    await fireEvent.click(chip)
    expect(screen.getByText('0 of 2 shown')).toBeInTheDocument()
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
  })
})

describe('PivotFieldChip — dismissal and cleanup', () => {
  it('closes on an outside pointer press but not on one inside the menu', async () => {
    renderChip()
    await fireEvent.click(screen.getByRole('button', { name: 'Hero' }))

    // Pressing a menu item must not dismiss before the click lands — the
    // focusout-based close this replaced swallowed the WebKit toggle.
    await fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Remove' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('swallows Escape only while its own menu is open', async () => {
    // The chip lives inside the Matches workspace, where Escape closes the
    // detail panel and the narrow drawer. Consuming it with no menu open
    // would strand a user inside whichever surface is above the chip.
    const reachedDocument: string[] = []
    const spy = () => reachedDocument.push('escape')
    document.addEventListener('keydown', spy)
    try {
      renderChip()
      const chip = screen.getByRole('button', { name: 'Hero' })

      await fireEvent.keyDown(chip, { key: 'Escape' })
      expect(reachedDocument).toHaveLength(1)

      await fireEvent.click(chip)
      await fireEvent.keyDown(chip, { key: 'Escape' })
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(reachedDocument).toHaveLength(1)
    } finally {
      document.removeEventListener('keydown', spy)
    }
  })

  it('drops its document listener when unmounted with the menu still open', async () => {
    const removeListener = vi.spyOn(document, 'removeEventListener')
    const { unmount } = renderChip()
    await fireEvent.click(screen.getByRole('button', { name: 'Hero' }))
    unmount()
    // A capture-phase document listener per chip would outlive the whole
    // pivot builder — twenty-odd chips re-render on every field move.
    expect(removeListener).toHaveBeenCalledWith('pointerdown', expect.any(Function), true)
    removeListener.mockRestore()
  })
})

describe('PivotFieldChip — drag payload', () => {
  // A real drag needs a browser, but the payload the chip writes is the wire
  // format the shelf and the pivot table parse back — it breaks silently.
  const transferStub = () => ({ setData: vi.fn() })

  it('writes the drop payload onto the transfer as portable text/plain', async () => {
    renderChip({ fieldId: 'damage', label: 'Damage', location: 'values', index: 2, aggLabel: 'Sum' })
    const dataTransfer = transferStub()
    await fireEvent.dragStart(screen.getByRole('button', { name: 'Damage Sum' }), { dataTransfer })

    // The index is what lets a drop on the tray remove the RIGHT value spec
    // when the same measure sits on the shelf twice.
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', '{"fieldId":"damage","from":"values","index":2}')
  })

  it('omits the index for a dimension chip that has no shelf position', async () => {
    renderChip({ location: 'tray' })
    const dataTransfer = transferStub()
    await fireEvent.dragStart(screen.getByRole('button', { name: 'Hero' }), { dataTransfer })
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', '{"fieldId":"hero","from":"tray"}')
  })
})
