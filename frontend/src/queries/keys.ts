// Query-key taxonomy — hierarchical so prefix invalidation works
// (`invalidateQueries({ queryKey: ['screenshots'] })` catches every
// screenshot-flavored read). No profile segment: switching profiles does a
// full window.location.reload(), which discards the whole cache.
export const qk = {
  matches:        ['matches'] as const,
  pendingCount:   ['screenshots', 'pending-count'] as const,
  failedFiles:    ['screenshots', 'failed'] as const,
  ignored:        ['screenshots', 'ignored'] as const,
  candidates:     ['screenshots', 'candidates'] as const,
  candidateStats: ['screenshots', 'candidate-stats'] as const,
  settings: {
    screenshotsDir: ['settings', 'screenshots-dir'] as const,
    watch:          ['settings', 'watch'] as const,
    exitOnClose:    ['settings', 'exit-on-close'] as const,
    tesseract:      ['settings', 'tesseract'] as const,
    autoBackup:     ['settings', 'auto-backup'] as const,
  },
  profiles:       ['profiles'] as const,
  // The loaned corpus nests UNDER the session on purpose: ending a
  // session invalidates the whole `['coach','session']` prefix and the
  // player's records go with it. The returns inbox is the player's own
  // side of the loop and lives on its own branch.
  coach: {
    session: ['coach', 'session'] as const,
    matches: ['coach', 'session', 'matches'] as const,
    returns: ['coach', 'returns'] as const,
  },
  system: {
    referenceData: ['system', 'reference-data'] as const,
    version:       ['system', 'version'] as const,
    dataLocation:  ['system', 'data-location'] as const,
    startupError:  ['system', 'startup-error'] as const,
    update:        ['system', 'update'] as const,
    parseStaleness: ['system', 'parse-staleness'] as const,
  },
  activeParse:    ['parses', 'active'] as const,
}

// The "matches cluster" — the three reads the matches store's load()
// refetched together; every match mutation's widest invalidation set.
export const matchesCluster = [qk.matches, qk.pendingCount, qk.failedFiles]
