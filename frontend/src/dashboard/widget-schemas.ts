/**
 * Per-widget config schemas and their config types.
 *
 * These live apart from `widgets.ts` for one structural reason: the registry
 * imports every widget COMPONENT, and every widget component needs its own
 * schema. Declaring the schemas beside the registry therefore made each widget
 * import the module that imports it — 45 runtime import cycles, one per widget,
 * where module-evaluation order was quietly load-bearing. Schemas have no
 * dependency on the components, so moving them here breaks every cycle.
 *
 * Import schemas FROM HERE, never from `@/dashboard/widgets`.
 */
import { makeSchema } from '@/dashboard/widget-config-schema'

// ─── Per-widget config schemas + types ──────────────────────────
//
// Declared inline (no extra files per widget) because each schema
// fits in a few lines and only the widget itself reads them. Each
// schema's defaults match the long-standing hardcoded constants so
// first hydrate is invisible to existing users — the popover (PR D)
// is the only path to a non-default value.

export interface TotalTimeConfig extends Record<string, unknown> {
  unit: 'hh:mm' | 'h' | 'd-h'
}
export const totalTimeSchema = makeSchema<TotalTimeConfig>([
  {
    kind:    'enum',
    key:     'unit',
    label:   'Display unit',
    choices: [
      { value: 'hh:mm', label: 'H:MM (e.g. 7h32min)' },
      { value: 'h',     label: 'Hours only' },
      { value: 'd-h',   label: 'Days + hours' },
    ],
    default: 'hh:mm',
  },
])

export interface MostPlayedHeroConfig extends Record<string, unknown> {
  minPercentPlayed: number
}
export const mostPlayedHeroSchema = makeSchema<MostPlayedHeroConfig>([
  {
    kind:    'integer-choice',
    key:     'minPercentPlayed',
    label:   'Min % played to count',
    choices: [10, 15, 20, 25, 30],
    default: 20,
  },
])

export interface TopByCountConfig extends Record<string, unknown> {
  limit: number
}
export const topMapsSchema = makeSchema<TopByCountConfig>([
  { kind: 'integer-choice', key: 'limit', label: 'Top N',
    choices: [3, 5, 10], default: 5 },
])
export const topHeroesSchema = makeSchema<TopByCountConfig>([
  { kind: 'integer-choice', key: 'limit', label: 'Top N',
    choices: [3, 5, 10], default: 3 },
])
export const topGameModesSchema = makeSchema<TopByCountConfig>([
  { kind: 'integer-choice', key: 'limit', label: 'Top N',
    choices: [3, 5], default: 5 },
])
export const withWhomSchema = makeSchema<TopByCountConfig>([
  { kind: 'integer-choice', key: 'limit', label: 'Top N',
    choices: [3, 5, 10], default: 5 },
])

export interface BestWinrateHeroConfig extends Record<string, unknown> {
  minMatches: number
}
export const bestWinrateHeroSchema = makeSchema<BestWinrateHeroConfig>([
  {
    kind:    'integer-choice',
    key:     'minMatches',
    label:   'Min decisive matches',
    choices: [3, 5, 10],
    default: 3,
  },
])

// Shared by the win-rate-by-hero / -map / -role widgets: a sample-size
// floor (so noise doesn't top the list) + a Top-N cap.
export interface WinrateByConfig extends Record<string, unknown> {
  minMatches: number
  limit:      number
}
export const winrateBySchema = makeSchema<WinrateByConfig>([
  { kind: 'integer-choice', key: 'minMatches', label: 'Min decisive matches', choices: [3, 5, 10], default: 5 },
  { kind: 'integer-choice', key: 'limit',      label: 'Top N',                choices: [3, 5, 10], default: 5 },
])

// Shared by the hero-swap discipline pair (Heroes per match + Hero pool): a
// hero under this percent of the match was probably touching the point, not
// a real swap, so it never counts as meaningfully played.
export interface HeroDisciplineConfig extends Record<string, unknown> {
  thresholdPct: number
}
export const heroDisciplineSchema = makeSchema<HeroDisciplineConfig>([
  {
    kind:    'integer-choice',
    key:     'thresholdPct',
    label:   'Ignore heroes under … % of the match',
    choices: [3, 5, 10],
    default: 5,
  },
])

export interface TimeOfDayConfig extends Record<string, unknown> {
  bucketCount: 6 | 12 | 24
}
export const timeOfDaySchema = makeSchema<TimeOfDayConfig>([
  {
    kind:    'integer-choice',
    key:     'bucketCount',
    label:   'Buckets',
    choices: [6, 12, 24],
    default: 6,
  },
])

export interface DayOfWeekConfig extends Record<string, unknown> {
  weekStartOverride: 'inherit' | 'monday' | 'sunday'
}
export const dayOfWeekSchema = makeSchema<DayOfWeekConfig>([
  {
    kind:    'enum',
    key:     'weekStartOverride',
    label:   'Week start',
    choices: [
      { value: 'inherit', label: 'Inherit (Calendar setting)' },
      { value: 'monday',  label: 'Monday' },
      { value: 'sunday',  label: 'Sunday' },
    ],
    default: 'inherit',
  },
])

export interface HeroGameModeHeatmapConfig extends Record<string, unknown> {
  heroLimit:  number
  minMatches: number
}
export const heroGameModeHeatmapSchema = makeSchema<HeroGameModeHeatmapConfig>([
  {
    kind:    'integer-choice',
    key:     'heroLimit',
    label:   'Heroes to show',
    choices: [5, 8, 12],
    default: 8,
  },
  {
    kind:    'integer-choice',
    key:     'minMatches',
    label:   'Min matches for full grid',
    choices: [10, 20, 50],
    default: 20,
  },
])

export interface FormDeltaConfig extends Record<string, unknown> {
  window: number
}
export interface PerfVsRankConfig extends Record<string, unknown> { recentDays: number }
export const perfVsRankSchema = makeSchema<PerfVsRankConfig>([
  {
    kind:    'integer-choice',
    key:     'recentDays',
    label:   'Recent window (days)',
    choices: [7, 14, 30],
    default: 7,
  },
])

export interface RollingBaselineConfig extends Record<string, unknown> { recentDays: number; baselineDays: number }
export const rollingBaselineSchema = makeSchema<RollingBaselineConfig>([
  {
    kind:    'integer-choice',
    key:     'recentDays',
    label:   'Recent window (days)',
    choices: [7, 14],
    default: 7,
  },
  {
    kind:    'integer-choice',
    key:     'baselineDays',
    label:   'Baseline window (days)',
    choices: [30, 60, 90],
    default: 30,
  },
])

export interface ClimbVelocityConfig extends Record<string, unknown> { days: number }
export const climbVelocitySchema = makeSchema<ClimbVelocityConfig>([
  {
    kind:    'integer-choice',
    key:     'days',
    label:   'Window (days)',
    choices: [14, 30, 90],
    default: 30,
  },
])

export const formDeltaSchema = makeSchema<FormDeltaConfig>([
  {
    kind:    'integer-choice',
    key:     'window',
    label:   'Recent window (games)',
    choices: [10, 20, 30],
    default: 20,
  },
])

export interface LossStreakRecoveryConfig extends Record<string, unknown> {
  minStreak: number
}
export const lossStreakRecoverySchema = makeSchema<LossStreakRecoveryConfig>([
  {
    kind:    'integer-choice',
    key:     'minStreak',
    label:   'Losses in a row to trigger',
    choices: [2, 3],
    default: 2,
  },
])

export interface RecentMatchesConfig extends Record<string, unknown> {
  count: number
}
export const recentMatchesSchema = makeSchema<RecentMatchesConfig>([
  {
    kind:    'integer-choice',
    key:     'count',
    label:   'Results to show',
    choices: [3, 5, 10],
    default: 5,
  },
])
