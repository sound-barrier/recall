import { describe, it, expect } from 'vitest'

import { renderApp, mockedApi } from '@/test-utils'

// The profiles list used to be fetched from four-plus undeduped places at
// boot (first-run gate, active-profile flag, masthead switcher, move
// picker). The shared query collapses them onto one cache entry — this
// pins the dedup so a stray direct GetProfiles call can't sneak back in.
describe('profiles query dedup', () => {
  it('boot issues exactly one GetProfiles across all consumers', async () => {
    await renderApp()
    expect(mockedApi().GetProfiles).toHaveBeenCalledTimes(1)
  })
})
