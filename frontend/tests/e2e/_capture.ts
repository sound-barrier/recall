/**
 * Typed slots for values a spec captures inside a `page.route()` callback.
 *
 * The obvious shape — `let body: T | null = null`, assigned in the callback —
 * does not type-check: TypeScript's control-flow analysis cannot see the
 * callback ever running, so at the assertion below it the variable is still
 * narrowed to `null`. Specs used to paper over that with `as string` or `?.`,
 * which is exactly the "assertion over narrowing" smell the root CLAUDE.md
 * bans. Routing the read through a method boundary defeats the narrowing
 * honestly — no `!`, no `as`.
 *
 * Usage:
 *     const body = routeCapture<{ note?: string }>()
 *     await page.route('**\/api/v1/x', async (route) => {
 *       body.set(JSON.parse(route.request().postData() ?? '{}'))
 *       await route.fulfill({ status: 204, body: '' })
 *     })
 *     await expect.poll(() => body.seen()).toBe(true)
 *     expect(body.get().note).toBe('…')
 */
export interface RouteCapture<T> {
  /** Record the value seen by the route callback (last write wins). */
  set(value: T): void
  /** Whether the route has fired yet — the `expect.poll` predicate. */
  seen(): boolean
  /** The captured value; throws with a diagnostic if the route never fired. */
  get(): T
}

export function routeCapture<T>(what = 'request body'): RouteCapture<T> {
  let box: { value: T } | null = null
  return {
    set(value: T) {
      box = { value }
    },
    seen: () => box !== null,
    get(): T {
      const captured = box
      if (!captured) throw new Error(`no ${what} captured — did the route ever fire?`)
      return captured.value
    },
  }
}

/**
 * Unwraps a value that `noUncheckedIndexedAccess` (or a nullable DOM read like
 * `textContent()`) types as possibly absent, failing loudly instead of silently
 * asserting with `!`. The message names what was missing, so a broken fixture
 * reads as a fixture problem rather than "Cannot read properties of undefined".
 */
export function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`expected ${what} to be present`)
  return value
}
