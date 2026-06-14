import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import WidgetConfigPopover from '@/components/WidgetConfigPopover.vue'
import { makeSchema, EMPTY_SCHEMA } from '@/dashboard/widget-config-schema'
import type { WidgetDef } from '@/dashboard/widgets'
import { defineComponent, h } from 'vue'

// In-memory localStorage shim — the popover writes to localStorage
// on Save via useWidgetConfig, so the round-trip needs to persist
// for the assertions to be meaningful.
function installLocalStorageShim(): Record<string, string> {
  const storage: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem:    (k: string) => storage[k] ?? null,
    setItem:    (k: string, v: string) => { storage[k] = String(v) },
    removeItem: (k: string) => { delete storage[k] },
    clear:      () => { for (const k of Object.keys(storage)) delete storage[k] },
    key:        (i: number) => Object.keys(storage)[i] ?? null,
    get length() { return Object.keys(storage).length },
  })
  return storage
}

const integerSchema = makeSchema<{ limit: number }>([
  { kind: 'integer-choice', key: 'limit', label: 'Top N', choices: [3, 5, 10], default: 5 },
])

const enumSchema = makeSchema<{ unit: string }>([
  {
    kind: 'enum', key: 'unit', label: 'Display unit',
    choices: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C' },
    ],
    default: 'a',
  },
])

function fakeDef(id: string, schema: typeof EMPTY_SCHEMA = EMPTY_SCHEMA): WidgetDef {
  return {
    id,
    eyebrow:   'Test widget',
    shape:     'kpi',
    defaultRow: 1,
    component: defineComponent({ render() { return h('div') } }),
    config:    schema,
  } as unknown as WidgetDef
}

function fakeRect(): DOMRect {
  return new DOMRect(100, 100, 24, 24)
}

describe('WidgetConfigPopover', () => {
  beforeEach(() => { installLocalStorageShim() })

  it('renders nothing when open=false', () => {
    const w = mount(WidgetConfigPopover, {
      props: { open: false, def: fakeDef('w', integerSchema), anchor: fakeRect() },
      attachTo: document.body,
    })
    expect(document.querySelector('[data-testid="widget-config-popover"]')).toBeNull()
    w.unmount()
  })

  it('renders nothing when schema is empty', () => {
    const w = mount(WidgetConfigPopover, {
      props: { open: true, def: fakeDef('w', EMPTY_SCHEMA), anchor: fakeRect() },
      attachTo: document.body,
    })
    expect(document.querySelector('[data-testid="widget-config-popover"]')).toBeNull()
    w.unmount()
  })

  it('renders a segmented row for an integer-choice schema', async () => {
    const w = mount(WidgetConfigPopover, {
      props: { open: true, def: fakeDef('top-heroes', integerSchema), anchor: fakeRect() },
      attachTo: document.body,
    })
    await flushPromises()
    const buttons = document.querySelectorAll('[data-widget-config-choice^="limit="]')
    expect(buttons.length).toBe(3)
    expect(buttons[0]!.textContent?.trim()).toBe('3')
    expect(buttons[1]!.textContent?.trim()).toBe('5')
    expect(buttons[2]!.textContent?.trim()).toBe('10')
    // Default value (5) is marked active.
    expect(buttons[1]!.classList.contains('wcp-segment-active')).toBe(true)
    w.unmount()
  })

  it('renders a radio list for an enum schema', async () => {
    const w = mount(WidgetConfigPopover, {
      props: { open: true, def: fakeDef('total-time', enumSchema), anchor: fakeRect() },
      attachTo: document.body,
    })
    await flushPromises()
    const radios = document.querySelectorAll('input[type="radio"]')
    expect(radios.length).toBe(3)
    // Default 'a' is checked.
    expect((radios[0] as HTMLInputElement).checked).toBe(true)
    w.unmount()
  })

  it('Save persists the selected value to localStorage', async () => {
    const w = mount(WidgetConfigPopover, {
      props: { open: true, def: fakeDef('top-heroes', integerSchema), anchor: fakeRect() },
      attachTo: document.body,
    })
    await flushPromises()
    // Pick limit=10.
    const limit10 = document.querySelector('[data-widget-config-choice="limit=10"]') as HTMLButtonElement
    limit10.click()
    await flushPromises()
    // Save.
    const save = document.querySelector('[data-testid="widget-config-save"]') as HTMLButtonElement
    save.click()
    await flushPromises()
    expect(localStorage.getItem('recall.dashboard.widget-config.top-heroes'))
      .toBe(JSON.stringify({ limit: 10 }))
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })

  it('Cancel discards the draft + emits close', async () => {
    const w = mount(WidgetConfigPopover, {
      props: { open: true, def: fakeDef('top-heroes', integerSchema), anchor: fakeRect() },
      attachTo: document.body,
    })
    await flushPromises()
    // Pick limit=10 then cancel.
    ;(document.querySelector('[data-widget-config-choice="limit=10"]') as HTMLButtonElement).click()
    await flushPromises()
    ;(document.querySelector('[data-testid="widget-config-cancel"]') as HTMLButtonElement).click()
    await flushPromises()
    // Nothing persisted.
    expect(localStorage.getItem('recall.dashboard.widget-config.top-heroes')).toBeNull()
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })

  it('Reset persists the schema defaults', async () => {
    // Pre-seed a non-default value so we can observe the reset.
    localStorage.setItem('recall.dashboard.widget-config.top-heroes', JSON.stringify({ limit: 10 }))
    const w = mount(WidgetConfigPopover, {
      props: { open: true, def: fakeDef('top-heroes', integerSchema), anchor: fakeRect() },
      attachTo: document.body,
    })
    await flushPromises()
    ;(document.querySelector('[data-testid="widget-config-reset"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(localStorage.getItem('recall.dashboard.widget-config.top-heroes'))
      .toBe(JSON.stringify({ limit: 5 }))
    w.unmount()
  })
})
