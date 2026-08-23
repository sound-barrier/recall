import type {
  DbHealth,
  GetParseStalenessResponses,
  GetReferenceDataResponses,
  GetScreenshotsFolderCandidateStatsResponses,
} from '@/client/types.gen'

// App-facing aliases over generated shapes. They live apart from any one
// endpoint family because several read them.

// The generated name is DbHealth; the app-facing alias predates it.
export type DBHealth = DbHealth

// Static Overwatch reference data baked into the parser at compile time
// from pkg/parser/{heroes,maps,seasons,screenshot_sources}.yaml. Stable
// across a session — callers may fetch once at app load and cache. The
// shape is the spec's inline response schema.
export type OWData = GetReferenceDataResponses[200]
export type ParseStaleness = GetParseStalenessResponses[200]

// NamedCandidateStats is the per-source diagnostic blob the picker grid
// hydrates AFTER the cards mount (file_count + last_modified +
// recognized_count). The shape is the spec's inline response schema.
export type NamedCandidateStats = GetScreenshotsFolderCandidateStatsResponses[200][number]
