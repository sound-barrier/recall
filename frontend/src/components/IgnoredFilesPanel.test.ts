// SFC tests for IgnoredFilesPanel — the Settings → Advanced → "Manage
// ignored files" modal. Backend wiring + the broader Delete-forever →
// Restore → Re-parse round-trip live in the e2e spec
// `unknown-restore-ignored.spec.ts`; here we cover the in-component
// state machine (arm/disarm), per-row emits, and accessibility-y
// branches (empty state, restore footer, Escape close).

import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'

import IgnoredFilesPanel from './IgnoredFilesPanel.vue'

const SAMPLE = [
  { filename: 'a.png', ignored_at: '2026-06-04T15:00:00Z' },
  { filename: 'b.png', ignored_at: '2026-06-04T14:00:00Z' },
]

function mountPanel(overrides: Partial<{ isOpen: boolean; screenshots: typeof SAMPLE }> = {}) {
  return mount(IgnoredFilesPanel, {
    props: {
      isOpen:        overrides.isOpen ?? true,
      screenshots:   overrides.screenshots ?? SAMPLE,
      screenshotURL: (f: string) => `/_screenshot/${encodeURIComponent(f)}`,
    },
    attachTo: document.body,
  })
}

describe('IgnoredFilesPanel', () => {
  it('renders nothing when isOpen=false', () => {
    const wrapper = mountPanel({ isOpen: false })
    expect(wrapper.find('.ignored-backdrop').exists()).toBe(false)
  })

  it('renders count + one row per screenshot', () => {
    const wrapper = mountPanel()
    expect(wrapper.find('.ignored-count').text()).toBe('2')
    expect(wrapper.findAll('.ignored-row')).toHaveLength(2)
    const firstThumb = wrapper.find('.ignored-row .ignored-thumb')
    expect(firstThumb.attributes('src')).toContain(encodeURIComponent('a.png'))
    expect(firstThumb.attributes('loading')).toBe('lazy')
  })

  it('shows empty-state copy when the list is empty', () => {
    const wrapper = mountPanel({ screenshots: [] })
    expect(wrapper.find('.ignored-empty').exists()).toBe(true)
    expect(wrapper.findAll('.ignored-row')).toHaveLength(0)
    // The bulk-action button MUST be hidden — "Re-enable all (0)" would
    // be confusing and a no-op.
    expect(wrapper.find('.ignored-restore-all').exists()).toBe(false)
  })

  it('per-row Restore emits restore with the filename', async () => {
    const wrapper = mountPanel()
    await wrapper.findAll('.ignored-restore')[0]!.trigger('click')
    expect(wrapper.emitted('restore')).toEqual([['a.png']])
  })

  it('shows the Run-Parse footer after a per-row Restore', async () => {
    const wrapper = mountPanel()
    expect(wrapper.find('.ignored-foot').exists()).toBe(false)
    await wrapper.findAll('.ignored-restore')[0]!.trigger('click')
    expect(wrapper.find('.ignored-foot').exists()).toBe(true)
    await wrapper.find('.ignored-runparse').trigger('click')
    expect(wrapper.emitted('run-parse')).toBeTruthy()
  })

  it('Re-enable all is two-step: arm then confirm', async () => {
    const wrapper = mountPanel()
    // First click arms — Confirm? hint appears, original button replaced.
    await wrapper.find('.ignored-restore-all').trigger('click')
    expect(wrapper.emitted('restore-all')).toBeFalsy()
    expect(wrapper.find('.ignored-armed-hint').exists()).toBe(true)
    expect(wrapper.find('.ignored-restore-all').exists()).toBe(false)
    // Second click confirms.
    await wrapper.find('.ignored-restore-all-confirm').trigger('click')
    expect(wrapper.emitted('restore-all')).toEqual([[]])
  })

  it('Cancel disarms without emitting restore-all', async () => {
    const wrapper = mountPanel()
    await wrapper.find('.ignored-restore-all').trigger('click')
    await wrapper.find('.ignored-restore-all-cancel').trigger('click')
    expect(wrapper.emitted('restore-all')).toBeFalsy()
    expect(wrapper.find('.ignored-restore-all').exists()).toBe(true)
  })

  it('3 s auto-disarm timer drops the arm if the user walks away', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mountPanel()
      await wrapper.find('.ignored-restore-all').trigger('click')
      expect(wrapper.find('.ignored-armed-hint').exists()).toBe(true)
      vi.advanceTimersByTime(3100)
      // Vue re-renders on the next tick; assert state via DOM after a
      // microtask flush.
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.ignored-armed-hint').exists()).toBe(false)
      expect(wrapper.find('.ignored-restore-all').exists()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('Close button emits close', async () => {
    const wrapper = mountPanel()
    await wrapper.find('.ignored-close').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('Backdrop click emits close; inner-panel click does not', async () => {
    const wrapper = mountPanel()
    // Clicking the backdrop where currentTarget === target → close.
    await wrapper.find('.ignored-backdrop').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
    // Clicking inside the panel (not the backdrop) → no close emit.
    const before = wrapper.emitted('close')!.length
    await wrapper.find('.ignored-title').trigger('click')
    expect(wrapper.emitted('close')!.length).toBe(before)
  })

  // NOTE: Escape close uses a capture-phase document keydown listener.
  // happy-dom doesn't fire capture-phase listeners from synthesized
  // KeyboardEvents (same limitation MatchScreenshotLightbox runs into,
  // see its test file comment) — the Escape contract is exercised in
  // the Playwright e2e instead. The unit test would be a stub.
})
