import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/vue'

import BulkActionBar from '@/components/matches/bulk/BulkActionBar.vue'

// The write gate reads the profiles query + the coaching-session store;
// these cases pin this component's own contract, so stub it open.
vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))

function renderBar(props: Record<string, unknown> = {}) {
  return render(BulkActionBar, {
    props: {
      selectedCount: 3,
      sortedCount: 10,
      otherProfiles: [] as readonly string[],
      movePickerOpen: null,
      ...props,
    },
  })
}

async function openMenu(name: string) {
  await fireEvent.click(screen.getByRole('button', { name }))
}

describe('BulkActionBar', () => {
  describe('selection readout', () => {
    it('offers "Select all" only while the selection is a strict subset of the list', async () => {
      const { emitted, rerender } = renderBar({ selectedCount: 3, sortedCount: 10 })
      expect(screen.getByRole('region', { name: 'Bulk action bar' })).toHaveTextContent('3 selected')
      await fireEvent.click(screen.getByRole('button', { name: 'Select all (10)' }))
      expect(emitted('selectAll')).toHaveLength(1)

      await rerender({ selectedCount: 10, sortedCount: 10 })
      expect(screen.queryByRole('button', { name: 'Select all (10)' })).not.toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'Bulk action bar' })).toHaveTextContent('10 selected')
    })
  })

  describe('one-shot actions', () => {
    it('emits one action per button', async () => {
      const { emitted } = renderBar()
      await fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
      await fireEvent.click(screen.getByRole('button', { name: 'Review these (3)' }))
      await fireEvent.click(screen.getByRole('button', { name: 'Export backup…' }))
      await fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
      await fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      expect(emitted('hide')).toHaveLength(1)
      expect(emitted('reviewThese')).toHaveLength(1)
      expect(emitted('exportBundle')).toHaveLength(1)
      expect(emitted('exportCsv')).toHaveLength(1)
      expect(emitted('clear')).toHaveLength(1)
    })
  })

  describe('move sub-mode', () => {
    it('hides "Move to…" when there is nowhere to move the selection', () => {
      renderBar({ otherProfiles: [] })
      expect(screen.queryByRole('button', { name: 'Move to…' })).not.toBeInTheDocument()
    })

    it('swaps the whole action row for the target chooser while the picker is live', async () => {
      const { emitted, rerender } = renderBar({ otherProfiles: ['alt', 'smurf'] })
      await fireEvent.click(screen.getByRole('button', { name: 'Move to…' }))
      expect(emitted('moveBegin')).toHaveLength(1)

      await rerender({ selectedCount: 3, sortedCount: 10, otherProfiles: ['alt', 'smurf'], movePickerOpen: 'live' })
      // The destructive/bulk buttons must not be reachable mid-move.
      expect(screen.queryByRole('button', { name: 'Hide' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Set play mode' })).not.toBeInTheDocument()
      await fireEvent.click(screen.getByRole('button', { name: 'alt' }))
      expect(emitted('moveCommit')?.[0]).toEqual(['alt'])
      await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(emitted('moveCancel')).toHaveLength(1)

      await rerender({ selectedCount: 3, sortedCount: 10, otherProfiles: ['alt', 'smurf'], movePickerOpen: null })
      expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument()
    })

    it('keeps the normal action row for the archive sub-mode', () => {
      renderBar({ otherProfiles: ['alt'], movePickerOpen: 'archive' })
      expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    })
  })

  describe('dropdown menus', () => {
    it('opens at most one menu — a second trigger collapses the first', async () => {
      renderBar()
      await openMenu('Set play mode')
      expect(screen.getByRole('button', { name: 'Set play mode' })).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('menu', { name: 'Set play mode for selected matches' })).toBeInTheDocument()

      await openMenu('Set queue')
      expect(screen.getByRole('button', { name: 'Set play mode' })).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('menu', { name: 'Set play mode for selected matches' })).not.toBeInTheDocument()
      expect(screen.getByRole('menu', { name: 'Set queue type for selected matches' })).toBeInTheDocument()
    })

    it('closes on a second click of the same trigger', async () => {
      renderBar()
      await openMenu('Set play mode')
      await openMenu('Set play mode')
      expect(screen.getByRole('button', { name: 'Set play mode' })).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('menu', { name: 'Set play mode for selected matches' })).not.toBeInTheDocument()
    })

    it('writes each play-mode item as its own value and closes the menu', async () => {
      const { emitted } = renderBar()
      await openMenu('Set play mode')
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Quickplay' }))
      expect(emitted('bulkPlayMode')?.[0]).toEqual(['quickplay'])
      expect(screen.getByRole('button', { name: 'Set play mode' })).toHaveAttribute('aria-expanded', 'false')

      await openMenu('Set play mode')
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Competitive' }))
      expect(emitted('bulkPlayMode')?.[1]).toEqual(['competitive'])
    })

    it('clears the play mode with the empty-string sentinel', async () => {
      const { emitted } = renderBar()
      await openMenu('Set play mode')
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Clear (Unknown mode)' }))
      expect(emitted('bulkPlayMode')?.[0]).toEqual([''])
    })

    it('writes the picked queue type, and clears it with the empty-string sentinel', async () => {
      const { emitted } = renderBar()
      await openMenu('Set queue')
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Open Queue' }))
      expect(emitted('bulkQueue')?.[0]).toEqual(['open'])
      await openMenu('Set queue')
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Role Queue' }))
      expect(emitted('bulkQueue')?.[1]).toEqual(['role'])
      await openMenu('Set queue')
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Clear (Unknown mode type)' }))
      expect(emitted('bulkQueue')?.[2]).toEqual([''])
    })
  })

  describe('bulk tag', () => {
    it('adopts an existing tag from the suggestion list', async () => {
      const { emitted } = renderBar({ availableTags: ['clutch', 'throw'] })
      await openMenu('Tag')
      await fireEvent.mouseDown(screen.getByRole('option', { name: 'clutch' }))
      expect(emitted('bulkTag')?.[0]).toEqual(['clutch'])
      expect(screen.getByRole('button', { name: 'Tag' })).toHaveAttribute('aria-expanded', 'false')
    })

    it('coins a free-typed tag, normalized to trimmed lower case', async () => {
      const { emitted } = renderBar({ availableTags: ['clutch'] })
      await openMenu('Tag')
      const input = screen.getByRole('combobox', { name: 'Tag selected matches' })
      await fireEvent.update(input, '  Rage Quit  ')
      await fireEvent.keyDown(input, { key: 'Enter' })
      expect(emitted('bulkTag')?.[0]).toEqual(['rage quit'])
    })

    it('still offers the free-text path when the corpus has no tag vocabulary yet', async () => {
      const { emitted } = renderBar()
      await openMenu('Tag')
      expect(screen.getByText('no tags yet — type a new one + Enter')).toBeInTheDocument()
      const input = screen.getByRole('combobox', { name: 'Tag selected matches' })
      await fireEvent.update(input, 'first')
      await fireEvent.keyDown(input, { key: 'Enter' })
      expect(emitted('bulkTag')?.[0]).toEqual(['first'])
    })

    it('closes the tag menu on Escape without tagging anything', async () => {
      const { emitted } = renderBar({ availableTags: ['clutch'] })
      await openMenu('Tag')
      await fireEvent.keyDown(screen.getByRole('combobox', { name: 'Tag selected matches' }), { key: 'Escape' })
      expect(screen.getByRole('button', { name: 'Tag' })).toHaveAttribute('aria-expanded', 'false')
      expect(emitted('bulkTag')).toBeUndefined()
    })
  })
})
