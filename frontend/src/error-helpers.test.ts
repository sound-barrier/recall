import { describe, it, expect } from 'vitest'
import { plainLanguageError } from '@/error-helpers'

describe('plainLanguageError', () => {
  it('rewrites "permission denied" to a CTA', () => {
    expect(plainLanguageError('stat /Users/x/Documents: permission denied'))
      .toMatch(/Cannot access.*read access/i)
  })

  it('rewrites "not a directory" to a CTA', () => {
    expect(plainLanguageError('open /tmp/foo.png: not a directory'))
      .toMatch(/points to a file/i)
  })

  it('rewrites "no such file or directory" to a CTA', () => {
    expect(plainLanguageError('open /Users/x/gone: no such file or directory'))
      .toMatch(/no longer exists/i)
  })

  it('rewrites Windows "cannot find the path" to a CTA', () => {
    expect(plainLanguageError('CreateFile C:\\nope: The system cannot find the path specified.'))
      .toMatch(/no longer exists/i)
  })

  it('rewrites "connection refused" to a network CTA', () => {
    expect(plainLanguageError('dial tcp 127.0.0.1:7099: connect: connection refused'))
      .toMatch(/Cannot reach the server/i)
  })

  it('rewrites Go timeout errors', () => {
    expect(plainLanguageError('context deadline exceeded'))
      .toMatch(/took too long/i)
  })

  it('rewrites tesseract exec failures', () => {
    expect(plainLanguageError('exec: "tesseract": executable file not found in $PATH'))
      .toMatch(/Settings → Engine/i)
  })

  it('rewrites "no space left on device"', () => {
    expect(plainLanguageError('write /tmp/recall.db-wal: no space left on device'))
      .toMatch(/disk is full/i)
  })

  it('leaves unmatched errors unchanged', () => {
    const raw = 'something extremely specific that we have no pattern for'
    expect(plainLanguageError(raw)).toBe(raw)
  })

  it('is case-insensitive on common patterns', () => {
    expect(plainLanguageError('PERMISSION DENIED')).toMatch(/Cannot access/)
  })
})
