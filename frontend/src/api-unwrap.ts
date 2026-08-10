import { toApiError } from '@/api-error'

// The generated SDK's result envelope. Shared by the JSON facade (api.ts)
// and the binary/native surface (api-platform.ts) — it lives in its own
// module because api.ts imports api-platform, so api-platform importing
// the helpers back from api.ts would be a cycle.
interface SdkResult<T> {
  data?: T
  error?: unknown
  response?: Response
}

// throwSdkError converts an envelope error into the facade contract: an
// ApiError carrying the HTTP status, or the raw failure when the request
// never reached a response (fetch rejected — matching the old shim).
function throwSdkError(error: unknown, response: Response | undefined): never {
  if (!response) {
    if (error instanceof Error) throw error
    throw new Error(typeof error === 'string' ? error : JSON.stringify(error))
  }
  throw toApiError(response.status, error)
}

// unwrap resolves with the payload, or throws ApiError on an HTTP error.
export async function unwrap<T>(p: Promise<SdkResult<T>>): Promise<T> {
  const { data, error, response } = await p
  if (error === undefined) return data as T
  throwSdkError(error, response)
}

// unwrapVoid is unwrap for 204/202 writers — the empty-body payload is
// discarded so void-returning callers resolve to undefined.
export async function unwrapVoid(p: Promise<SdkResult<unknown>>): Promise<void> {
  await unwrap(p)
}

// unwrapWithResponse keeps the raw Response alongside the payload — the
// binary download paths read their filename off `Content-Disposition`.
export async function unwrapWithResponse<T>(
  p: Promise<SdkResult<T>>,
): Promise<{ data: T; response: Response }> {
  const { data, error, response } = await p
  if (error !== undefined) throwSdkError(error, response)
  return { data: data as T, response: response as Response }
}
