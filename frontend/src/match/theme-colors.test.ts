import { describe, it, expect, afterEach } from 'vitest'

import { cssVar, resolveColor, themeColor, withAlpha } from '@/match/theme-colors'

function setToken(name: string, value: string): void {
  document.documentElement.style.setProperty(name, value)
}

afterEach(() => {
  document.documentElement.style.removeProperty('--probe-color')
})

describe('cssVar', () => {
  it('reads a custom property off the document root', () => {
    setToken('--probe-color', '#1f5491')
    expect(cssVar('--probe-color')).toBe('#1f5491')
  })

  it('falls back when the token is undefined', () => {
    expect(cssVar('--not-a-token', '#abcdef')).toBe('#abcdef')
  })
})

describe('resolveColor', () => {
  // The regression this module exists for. The high-contrast palette
  // defines --tank as the 3-digit `#6df`; the old chart code built its
  // gradient stops with `${color}40`, yielding the invalid `#6df40`.
  // ECharts renders an unparseable colour as transparent, so the area
  // fill silently disappeared on that theme only.
  it('expands 3-digit hex so an alpha suffix cannot corrupt it', () => {
    expect(resolveColor('#6df')).toBe('#66ddff')
  })

  it('expands 4-digit hex', () => {
    expect(resolveColor('#6df8')).toBe('#66ddff88')
  })

  it('leaves 6-digit hex untouched', () => {
    expect(resolveColor('#1f5491')).toBe('#1f5491')
  })

  it('returns empty input unchanged', () => {
    expect(resolveColor('')).toBe('')
  })
})

describe('withAlpha', () => {
  it('applies alpha to a 3-digit hex without producing invalid syntax', () => {
    expect(withAlpha('#6df', 0.25)).toBe('rgba(102, 221, 255, 0.25)')
  })

  it('applies alpha to a 6-digit hex', () => {
    expect(withAlpha('#1f5491', 0.5)).toBe('rgba(31, 84, 145, 0.5)')
  })

  it('applies alpha to an rgb() string', () => {
    expect(withAlpha('rgb(31, 84, 145)', 0.4)).toBe('rgba(31, 84, 145, 0.4)')
  })

  it('replaces an existing alpha rather than compounding it', () => {
    expect(withAlpha('rgba(31, 84, 145, 0.8)', 0.2)).toBe('rgba(31, 84, 145, 0.2)')
  })

  it('emits a transparent stop at alpha 0 — the gradient baseline', () => {
    expect(withAlpha('#6df', 0)).toBe('rgba(102, 221, 255, 0)')
  })
})

describe('themeColor', () => {
  it('reads a token and normalises it in one step', () => {
    setToken('--probe-color', '#6df')
    expect(themeColor('--probe-color')).toBe('#66ddff')
  })

  it('normalises the fallback when the token is missing', () => {
    expect(themeColor('--not-a-token', '#6df')).toBe('#66ddff')
  })
})
