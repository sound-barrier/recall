import { describe, expect, it } from 'vitest'

import { UPDATE_REFUSAL_TOKEN, updaterErrorPhase } from '@/self-update-events'

// Messages as the wails:updater:error event carries them: Wails flattens the
// Go error and puts its own prefixes in front of the provider's text.
const REFUSED_BEHIND_PREFIXES =
  'updater: all providers failed: github: update refused: release 0.34.0 is not covered by its SHA256SUMS'
const NETWORK_FAILURE =
  'updater: all providers failed: github: Get "https://api.github.com/repos/sound-barrier/recall/releases/latest": dial tcp: lookup api.github.com: no such host'
const CONNECTION_REFUSED =
  'updater: all providers failed: github: Get "https://api.github.com/repos/sound-barrier/recall/releases/latest": dial tcp 140.82.112.6:443: connect: connection refused'
const CONNECTION_REFUSED_WINDOWS =
  'updater: all providers failed: github: Get "https://api.github.com/repos/sound-barrier/recall/releases/latest": dial tcp 140.82.112.6:443: connectex: No connection could be made because the target machine actively refused it.'

describe('updaterErrorPhase', () => {
  it('reads a refusal behind the updater\'s own prefixes as refused', () => {
    expect(updaterErrorPhase(REFUSED_BEHIND_PREFIXES)).toBe('refused')
  })

  it('reads a refusal that leads the message as refused', () => {
    expect(updaterErrorPhase('update refused: release 0.34.0 has a SHA256SUMS entry that is not a SHA-256 digest')).toBe('refused')
  })

  it('reads a network failure as an ordinary error', () => {
    expect(updaterErrorPhase(NETWORK_FAILURE)).toBe('error')
  })

  // A dropped connection says "refused" too, and it must not get the dialog's
  // verification notice: only the whole token marks a refusal.
  it('reads a refused connection as an ordinary error', () => {
    expect(updaterErrorPhase(CONNECTION_REFUSED)).toBe('error')
    expect(updaterErrorPhase(CONNECTION_REFUSED_WINDOWS)).toBe('error')
  })

  it('reads an empty or missing message as an ordinary error', () => {
    expect(updaterErrorPhase('')).toBe('error')
    expect(updaterErrorPhase(undefined)).toBe('error')
  })
})

// Lockstep with errUpdateRefused in pkg/cmd/selfupdate.go, whose text Go's
// TestErrUpdateRefused_CarriesTheDialogTokenHoweverWrapped pins from its side.
// A change to either literal must change both.
describe('UPDATE_REFUSAL_TOKEN', () => {
  it('is the text of the Go refusal sentinel', () => {
    expect(UPDATE_REFUSAL_TOKEN).toBe('update refused')
  })
})
