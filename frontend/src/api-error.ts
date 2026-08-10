import type { ProblemDetails } from '@/client/types.gen'

// ApiError is thrown by every facade call when the server responds with a
// non-2xx status. The status code lets callers distinguish user/config
// errors (4xx) from unexpected server faults (5xx).
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    // The parsed RFC 9457 problem object when the server replied with
    // application/problem+json; undefined for plain-text errors.
    public readonly problem?: ProblemDetails,
  ) {
    super(`HTTP ${status}: ${body}`)
    this.name = 'ApiError'
  }
}

// An error payload counts as RFC 9457-shaped when it carries a string
// title or detail — the two fields the UI reads.
function isProblemShaped(e: object): e is ProblemDetails {
  const p = e as Partial<ProblemDetails>
  return typeof p.title === 'string' || typeof p.detail === 'string'
}

// toApiError converts the generated client's error value — the JSON-parsed
// body when parseable, else the raw text — into an ApiError. The detail is
// kept on `body` so display call sites keep working.
export function toApiError(status: number, error: unknown): ApiError {
  if (typeof error === 'object' && error !== null) {
    if (isProblemShaped(error)) {
      return new ApiError(status, error.detail || error.title || '', error)
    }
    return new ApiError(status, JSON.stringify(error))
  }
  if (typeof error === 'string') return new ApiError(status, error)
  // Non-object, non-string primitives (a number, a boolean) can only come
  // from a malformed body; render them literally.
  return new ApiError(status, error == null ? '' : String(error as number | boolean))
}

