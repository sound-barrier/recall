// Macrotask flush — resolves after pending microtasks plus one timer
// turn, mirroring @vue/test-utils' flushPromises (which the Testing
// Library stack doesn't ship). Await it after driving async component
// behavior so promise chains and Vue's scheduler settle before
// asserting on the DOM.
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}
