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
    coaching:       ['settings', 'coaching'] as const,
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
  // The player's own saved review sittings — its own branch: it is the
  // player's data, not part of the coaching loop, and it outlives both.
  selfReviews: ['self-reviews'] as const,
  // What the player is working on — assembled server-side from BOTH
  // families that feed it, so it is its own read rather than something
  // derived from the two branches above.
  focus: ['focus'] as const,
  shares: ['shares'] as const,
  coachPlayers: ['coach-players'] as const,
  coachPlayerNotesAll: ['coach-player-notes'] as const,
  coachPlayerNotes: (id: number) => ['coach-player-notes', id] as const,
  coachPlayerSessionsAll: ['coach-player-sessions'] as const,
  coachPlayerSessions: (id: number) => ['coach-player-sessions', id] as const,
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

// The "matches cluster" — the reads the matches store's load() refetches
// together; every match mutation's widest invalidation set.
//
// parseStaleness belongs here because load() is what runs after a parse
// completes, and after a clear / restore / import — exactly the events that
// change how many matches an older parser read. Without it the staleness notice
// could not be cleared by the one action it asks for: the user clicks
// "Re-parse all now", every row is restamped, and the banner keeps naming the
// same count until the app is restarted.
export const matchesCluster = [qk.matches, qk.pendingCount, qk.failedFiles, qk.system.parseStaleness]
