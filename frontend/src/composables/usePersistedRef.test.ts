import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import {
  usePersistedRef,
  parseBoolish,
  serializeBoolish,
  parseEnum,
  parseClampedNumber,
} from './usePersistedRef'

let storage: Record<string, string>

function mountWith<T>(opts: Parameters<typeof usePersistedRef<T>>[0]) {
  let api!: ReturnType<typeof usePersistedRef<T>>
  const Comp = defineComponent({
    setup() {
      api = usePersistedRef(opts)
      return () => h('div')
    },
  })
  mount(Comp)
  return api
}

describe('usePersistedRef', () => {
  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value },
    })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('defaults to defaultValue when nothing stored', async () => {
    const { value } = mountWith({ key: 'k', defaultValue: 'dark', parse: parseEnum('dark', 'light') })
    await flushPromises()
    expect(value.value).toBe('dark')
  })

  it('hydrates from stored value on mount', async () => {
    storage['k'] = 'light'
    const { value } = mountWith({ key: 'k', defaultValue: 'dark', parse: parseEnum('dark', 'light') })
    await flushPromises()
    expect(value.value).toBe('light')
  })

  it('falls back to default for an unparseable stored value', async () => {
    storage['k'] = 'magenta'
    const { value } = mountWith({ key: 'k', defaultValue: 'dark', parse: parseEnum('dark', 'light') })
    await flushPromises()
    expect(value.value).toBe('dark')
  })

  it('set writes both the ref and localStorage', async () => {
    const { value, set } = mountWith({ key: 'k', defaultValue: 'dark', parse: parseEnum('dark', 'light') })
    set('light')
    expect(value.value).toBe('light')
    expect(storage['k']).toBe('light')
  })

  it('set invokes onChange and onMount invokes it with the hydrated value', async () => {
    const onChange = vi.fn()
    storage['k'] = 'light'
    const { set } = mountWith({
      key: 'k', defaultValue: 'dark',
      parse: parseEnum('dark', 'light'),
      onChange,
    })
    await flushPromises()
    expect(onChange).toHaveBeenLastCalledWith('light')
    set('dark')
    expect(onChange).toHaveBeenLastCalledWith('dark')
  })

  it('uses the optional serializer for non-trivial round-trips', async () => {
    const { set } = mountWith<boolean>({
      key: 'k', defaultValue: false,
      parse: parseBoolish,
      serialize: serializeBoolish,
    })
    set(true)
    expect(storage['k']).toBe('true')
    set(false)
    expect(storage['k']).toBe('false')
  })

  it('localStorage throws on read → default value', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => {},
    })
    const { value } = mountWith({ key: 'k', defaultValue: 42, parse: parseClampedNumber(0, 100) })
    await flushPromises()
    expect(value.value).toBe(42)
  })

  it('localStorage throws on write → ref still updates, no crash', async () => {
    let writes = 0
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { writes++; throw new Error('QuotaExceeded') },
    })
    const { value, set } = mountWith({ key: 'k', defaultValue: false, parse: parseBoolish })
    set(true)
    expect(value.value).toBe(true)
    expect(writes).toBe(1)
  })
})

describe('parseBoolish', () => {
  it('returns true for "true", false for "false", undefined otherwise', () => {
    expect(parseBoolish('true')).toBe(true)
    expect(parseBoolish('false')).toBe(false)
    expect(parseBoolish('1')).toBeUndefined()
    expect(parseBoolish('')).toBeUndefined()
    expect(parseBoolish('yes')).toBeUndefined()
  })
})

describe('parseEnum', () => {
  it('accepts allowed values, returns undefined otherwise', () => {
    const p = parseEnum('a', 'b', 'c')
    expect(p('a')).toBe('a')
    expect(p('c')).toBe('c')
    expect(p('d')).toBeUndefined()
    expect(p('')).toBeUndefined()
  })
})

describe('parseClampedNumber', () => {
  it('clamps to the bounds and rejects non-numeric input', () => {
    const p = parseClampedNumber(0, 100)
    expect(p('50')).toBe(50)
    expect(p('-5')).toBe(0)
    expect(p('500')).toBe(100)
    expect(p('NaN')).toBeUndefined()
    expect(p('foo')).toBeUndefined()
    expect(p('')).toBeUndefined()
    expect(p('Infinity')).toBeUndefined()
  })

  it('handles fractional input', () => {
    const p = parseClampedNumber(0, 10)
    expect(p('3.5')).toBe(3.5)
  })
})
