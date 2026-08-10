import { describe, it, expect } from 'vitest'
import { ApiError, toApiError } from '@/api-error'

describe('toApiError', () => {
  it('maps an RFC 9457 problem object to detail + structured problem', () => {
    const problem = {
      type: 'https://github.com/sound-barrier/recall/problems/conflict',
      title: 'Conflict',
      status: 409,
      detail: 'profile name already exists',
    }
    const err = toApiError(409, problem)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(409)
    expect(err.body).toBe('profile name already exists')
    expect(err.problem?.type).toContain('conflict')
  })

  it('falls back to the title when detail is absent', () => {
    const err = toApiError(400, { type: 'x', title: 'Bad Request', status: 400 })
    expect(err.body).toBe('Bad Request')
  })

  it('keeps a plain-text error as the body with no problem', () => {
    const err = toApiError(503, 'unit-test network disabled')
    expect(err.body).toBe('unit-test network disabled')
    expect(err.problem).toBeUndefined()
  })

  it('stringifies a JSON error that is not problem-shaped', () => {
    const err = toApiError(500, { message: 'boom' })
    expect(err.body).toBe(JSON.stringify({ message: 'boom' }))
    expect(err.problem).toBeUndefined()
  })
})

