import { describe, expect, it } from 'vitest'
import {
  EMPTY_SCHEMA,
  makeSchema,
  type WidgetConfigField,
} from './widget-config-schema'

describe('EMPTY_SCHEMA', () => {
  it('has no fields', () => {
    expect(EMPTY_SCHEMA.fields).toHaveLength(0)
  })

  it('defaults() returns an empty object', () => {
    expect(EMPTY_SCHEMA.defaults()).toEqual({})
  })

  it('validate() returns an empty object regardless of input', () => {
    expect(EMPTY_SCHEMA.validate(undefined)).toEqual({})
    expect(EMPTY_SCHEMA.validate(null)).toEqual({})
    expect(EMPTY_SCHEMA.validate({ stray: 1 })).toEqual({})
    expect(EMPTY_SCHEMA.validate('garbage')).toEqual({})
  })
})

describe('makeSchema — integer-choice field', () => {
  const limitField: WidgetConfigField = {
    kind: 'integer-choice', key: 'limit', label: 'Top N',
    choices: [3, 5, 10], default: 5,
  }
  const schema = makeSchema<{ limit: number }>([limitField])

  it('defaults() seeds the field with its declared default', () => {
    expect(schema.defaults()).toEqual({ limit: 5 })
  })

  it('validate() accepts a value that is in choices', () => {
    expect(schema.validate({ limit: 10 })).toEqual({ limit: 10 })
  })

  it('validate() rejects a value not in choices and falls back to default', () => {
    expect(schema.validate({ limit: 7 })).toEqual({ limit: 5 })
  })

  it('validate() rejects non-integer numbers', () => {
    expect(schema.validate({ limit: 5.5 })).toEqual({ limit: 5 })
  })

  it('validate() rejects non-numeric values', () => {
    expect(schema.validate({ limit: '5' })).toEqual({ limit: 5 })
    expect(schema.validate({ limit: true })).toEqual({ limit: 5 })
    expect(schema.validate({ limit: null })).toEqual({ limit: 5 })
  })

  it('validate() returns defaults for null / non-object', () => {
    expect(schema.validate(null)).toEqual({ limit: 5 })
    expect(schema.validate('foo')).toEqual({ limit: 5 })
    expect(schema.validate(42)).toEqual({ limit: 5 })
  })

  it('validate() merges valid values with defaults for missing keys', () => {
    expect(schema.validate({})).toEqual({ limit: 5 })
  })
})

describe('makeSchema — enum field', () => {
  const unitField: WidgetConfigField = {
    kind: 'enum', key: 'unit', label: 'Display unit',
    choices: [
      { value: 'hh:mm', label: 'HH:MM' },
      { value: 'h',     label: 'Hours' },
      { value: 'd-h',   label: 'Days + Hours' },
    ],
    default: 'hh:mm',
  }
  const schema = makeSchema<{ unit: string }>([unitField])

  it('defaults() seeds the field with its declared default', () => {
    expect(schema.defaults()).toEqual({ unit: 'hh:mm' })
  })

  it('validate() accepts known values', () => {
    expect(schema.validate({ unit: 'd-h' })).toEqual({ unit: 'd-h' })
  })

  it('validate() rejects unknown values and falls back to default', () => {
    expect(schema.validate({ unit: 'minutes' })).toEqual({ unit: 'hh:mm' })
  })

  it('validate() rejects non-string types', () => {
    expect(schema.validate({ unit: 1 })).toEqual({ unit: 'hh:mm' })
  })
})

describe('makeSchema — boolean field', () => {
  const includeField: WidgetConfigField = {
    kind: 'boolean', key: 'includeDraws', label: 'Include draws',
    default: false,
  }
  const schema = makeSchema<{ includeDraws: boolean }>([includeField])

  it('defaults() seeds the field with its declared default', () => {
    expect(schema.defaults()).toEqual({ includeDraws: false })
  })

  it('validate() accepts true and false', () => {
    expect(schema.validate({ includeDraws: true })).toEqual({ includeDraws: true })
    expect(schema.validate({ includeDraws: false })).toEqual({ includeDraws: false })
  })

  it('validate() rejects truthy non-booleans', () => {
    expect(schema.validate({ includeDraws: 1 })).toEqual({ includeDraws: false })
    expect(schema.validate({ includeDraws: 'true' })).toEqual({ includeDraws: false })
  })
})

describe('makeSchema — multi-field shape', () => {
  const schema = makeSchema<{ limit: number; unit: string; flag: boolean }>([
    { kind: 'integer-choice', key: 'limit', label: 'L', choices: [3, 5], default: 3 },
    { kind: 'enum',           key: 'unit',  label: 'U', choices: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], default: 'a' },
    { kind: 'boolean',        key: 'flag',  label: 'F', default: false },
  ])

  it('validate() preserves valid keys + repairs invalid ones independently', () => {
    expect(schema.validate({ limit: 5, unit: 'nonsense', flag: 'no' })).toEqual({
      limit: 5,
      unit:  'a',     // fell back to default
      flag:  false,   // fell back to default
    })
  })

  it('validate() preserves a fully-valid object', () => {
    expect(schema.validate({ limit: 5, unit: 'b', flag: true })).toEqual({
      limit: 5, unit: 'b', flag: true,
    })
  })

  it('validate() ignores extra keys not in the schema', () => {
    expect(schema.validate({ limit: 3, unit: 'a', flag: true, extra: 'ignored' })).toEqual({
      limit: 3, unit: 'a', flag: true,
    })
  })
})
