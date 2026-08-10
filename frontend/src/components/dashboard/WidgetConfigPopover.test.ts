import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@/test-utils'
import WidgetConfigPopover from '@/components/dashboard/WidgetConfigPopover.vue'
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

// The popover teleports to <body> as a role="dialog", so every query
// runs through screen (document-scoped) rather than the container.
describe('WidgetConfigPopover', () => {
  beforeEach(() => { installLocalStorageShim() })

  it('renders nothing when open=false', () => {
    render(WidgetConfigPopover, {
      props: { open: false, def: fakeDef('w', integerSchema), anchor: fakeRect() },
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders nothing when schema is empty', () => {
    render(WidgetConfigPopover, {
      props: { open: true, def: fakeDef('w', EMPTY_SCHEMA), anchor: fakeRect() },
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders a segmented row for an integer-choice schema', async () => {
    render(WidgetConfigPopover, {
      props: { open: true, def: fakeDef('top-heroes', integerSchema), anchor: fakeRect() },
    })
    await flushPromises()
    const segments = screen.getAllByRole('radio')
    expect(segments).toHaveLength(3)
    expect(segments[0]).toHaveTextContent(/^3$/)
    expect(segments[1]).toHaveTextContent(/^5$/)
    expect(segments[2]).toHaveTextContent(/^10$/)
    // Default value (5) is the checked segment; the others are not.
    expect(segments[1]).toBeChecked()
    expect(segments[0]).not.toBeChecked()
    expect(segments[2]).not.toBeChecked()
  })

  it('renders a radio list for an enum schema', async () => {
    render(WidgetConfigPopover, {
      props: { open: true, def: fakeDef('total-time', enumSchema), anchor: fakeRect() },
    })
    await flushPromises()
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
    // Default 'a' is checked.
    expect(radios[0]).toBeChecked()
  })

  it('Save persists the selected value to localStorage', async () => {
    const user = userEvent.setup()
    const { emitted } = render(WidgetConfigPopover, {
      props: { open: true, def: fakeDef('top-heroes', integerSchema), anchor: fakeRect() },
    })
    await flushPromises()
    // Pick limit=10.
    await user.click(screen.getByRole('radio', { name: '10' }))
    // Save.
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await flushPromises()
    expect(localStorage.getItem('recall.dashboard.widget-config.top-heroes'))
      .toBe(JSON.stringify({ limit: 10 }))
    expect(emitted('close')).toBeTruthy()
  })

  it('Cancel discards the draft + emits close', async () => {
    const user = userEvent.setup()
    const { emitted } = render(WidgetConfigPopover, {
      props: { open: true, def: fakeDef('top-heroes', integerSchema), anchor: fakeRect() },
    })
    await flushPromises()
    // Pick limit=10 then cancel.
    await user.click(screen.getByRole('radio', { name: '10' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await flushPromises()
    // Nothing persisted.
    expect(localStorage.getItem('recall.dashboard.widget-config.top-heroes')).toBeNull()
    expect(emitted('close')).toBeTruthy()
  })

  it('Reset persists the schema defaults', async () => {
    const user = userEvent.setup()
    // Pre-seed a non-default value so we can observe the reset.
    localStorage.setItem('recall.dashboard.widget-config.top-heroes', JSON.stringify({ limit: 10 }))
    render(WidgetConfigPopover, {
      props: { open: true, def: fakeDef('top-heroes', integerSchema), anchor: fakeRect() },
    })
    await flushPromises()
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    await flushPromises()
    expect(localStorage.getItem('recall.dashboard.widget-config.top-heroes'))
      .toBe(JSON.stringify({ limit: 5 }))
  })
})
