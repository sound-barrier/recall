import type { Component } from 'vue'
import { EMPTY_SCHEMA, makeSchema, type WidgetConfigSchema } from '@/dashboard/widget-config-schema'
import WinrateWidget from '@/components/dashboard/widgets/WinrateWidget.vue'
import AvgKdaWidget from '@/components/dashboard/widgets/AvgKdaWidget.vue'
import TotalTimePlayedWidget from '@/components/dashboard/widgets/TotalTimePlayedWidget.vue'
import MostPlayedHeroWidget from '@/components/dashboard/widgets/MostPlayedHeroWidget.vue'
import MatchesReviewedWidget from '@/components/dashboard/widgets/MatchesReviewedWidget.vue'
import DaysSinceReviewWidget from '@/components/dashboard/widgets/DaysSinceReviewWidget.vue'
import WldSinceReviewWidget from '@/components/dashboard/widgets/WldSinceReviewWidget.vue'
import TopMapsWidget from '@/components/dashboard/widgets/TopMapsWidget.vue'
import TopHeroesWidget from '@/components/dashboard/widgets/TopHeroesWidget.vue'
import TopRolesWidget from '@/components/dashboard/widgets/TopRolesWidget.vue'
// PR B opt-in widgets. Registered here but NOT included in
// DEFAULT_ROW_LAYOUT — they only appear on a user's dossier after
// the user explicitly adds them via the customizer.
import CurrentStreakWidget from '@/components/dashboard/widgets/CurrentStreakWidget.vue'
import LongestWinStreakWidget from '@/components/dashboard/widgets/LongestWinStreakWidget.vue'
import HeroPoolSizeWidget from '@/components/dashboard/widgets/HeroPoolSizeWidget.vue'
import BestWinrateHeroWidget from '@/components/dashboard/widgets/BestWinrateHeroWidget.vue'
import TopGameModesWidget from '@/components/dashboard/widgets/TopGameModesWidget.vue'
import TimeOfDayWidget from '@/components/dashboard/widgets/TimeOfDayWidget.vue'
import DayOfWeekWidget from '@/components/dashboard/widgets/DayOfWeekWidget.vue'
import Recent5MatchesWidget from '@/components/dashboard/widgets/Recent5MatchesWidget.vue'
import QuickplayVsCompetitiveWidget from '@/components/dashboard/widgets/QuickplayVsCompetitiveWidget.vue'
import WinrateByPlayModeWidget from '@/components/dashboard/widgets/WinrateByPlayModeWidget.vue'
import WithWhomWidget from '@/components/dashboard/widgets/WithWhomWidget.vue'
import CurrentRankWidget from '@/components/dashboard/widgets/CurrentRankWidget.vue'
import WinrateByHeroWidget from '@/components/dashboard/widgets/WinrateByHeroWidget.vue'
import WinrateByMapWidget from '@/components/dashboard/widgets/WinrateByMapWidget.vue'
import WinrateByRoleWidget from '@/components/dashboard/widgets/WinrateByRoleWidget.vue'

// Central registry for the dossier's customizable dashboard widgets.
//
// `shape` drives the wrapper chrome (.kpi-tile or .breakdown). It's the
// widget's intrinsic visual footprint — orthogonal to which row it
// lives in. `defaultRow` is the INITIAL row assignment when the user
// adds the widget via the customizer; user customization can move it
// to any row.
//
// `DEFAULT_ROW_LAYOUT` is the source of truth for "what ships visible
// on first install" AND for the reconciler's re-add-when-missing
// pass. A widget that lives in `WIDGET_REGISTRY` but NOT in
// `DEFAULT_ROW_LAYOUT` is opt-in only — it shows up in the
// customizer's "+ Add" gallery but never appears on a user's dossier
// until they explicitly add it.
//
// IDs are stable, kebab-case, and live in user localStorage —
// NEVER rename. If a widget is removed, drop the entry; the
// reconciliation step in useDashboardLayout will silently drop
// orphan IDs from stored layouts.

export type WidgetShape = 'kpi' | 'breakdown'

export interface WidgetDef<TConfig extends Record<string, unknown> = Record<string, unknown>> {
  id:        string
  eyebrow:   string
  shape:     WidgetShape
  defaultRow: number
  component: Component
  // Declarative schema for this widget's user-tunable knobs. Empty
  // schema (`EMPTY_SCHEMA`) means "no configurable properties" —
  // DashboardWidget hides the gear affordance entirely. Populated
  // schemas drive the gear-popover's auto-generated form (top-N
  // selector, display unit, threshold choice, etc.) and the
  // localStorage round-trip via useWidgetConfig.
  //
  // Defaults inside each field MUST match the current behavior so
  // first hydrate is a no-op for existing users — schema rollout
  // is invisible until users open the gear popover and pick a
  // different value.
  config:    WidgetConfigSchema<TConfig>
}

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

export const WIDGET_REGISTRY: readonly WidgetDef[] = [
  { id: 'winrate',           eyebrow: 'Winrate',                      shape: 'kpi',       defaultRow: 1, component: WinrateWidget,         config: EMPTY_SCHEMA          },
  { id: 'avg-kda',           eyebrow: 'Avg K/D/A per 10min',          shape: 'kpi',       defaultRow: 1, component: AvgKdaWidget,          config: EMPTY_SCHEMA          },
  { id: 'total-time',        eyebrow: 'Total time played',            shape: 'kpi',       defaultRow: 1, component: TotalTimePlayedWidget, config: totalTimeSchema       },
  { id: 'most-played-hero',  eyebrow: 'Most played hero',             shape: 'kpi',       defaultRow: 1, component: MostPlayedHeroWidget,  config: mostPlayedHeroSchema  },
  { id: 'reviewed-count',    eyebrow: 'Matches reviewed',             shape: 'kpi',       defaultRow: 1, component: MatchesReviewedWidget, config: EMPTY_SCHEMA          },
  { id: 'days-since-review', eyebrow: 'Days since last review',       shape: 'kpi',       defaultRow: 1, component: DaysSinceReviewWidget, config: EMPTY_SCHEMA          },
  { id: 'wld-since-review',  eyebrow: 'W / L / D since last review',  shape: 'kpi',       defaultRow: 1, component: WldSinceReviewWidget,  config: EMPTY_SCHEMA          },
  { id: 'top-maps',          eyebrow: 'Most played maps',             shape: 'breakdown', defaultRow: 2, component: TopMapsWidget,         config: topMapsSchema         },
  { id: 'top-heroes',        eyebrow: 'Most played heroes',           shape: 'breakdown', defaultRow: 2, component: TopHeroesWidget,       config: topHeroesSchema       },
  { id: 'top-roles',         eyebrow: 'Most played roles',            shape: 'breakdown', defaultRow: 2, component: TopRolesWidget,        config: EMPTY_SCHEMA          },
  // PR B opt-in widgets (NOT in DEFAULT_ROW_LAYOUT).
  { id: 'current-streak',      eyebrow: 'Current streak',         shape: 'kpi',       defaultRow: 1, component: CurrentStreakWidget,    config: EMPTY_SCHEMA          },
  { id: 'longest-win-streak',  eyebrow: 'Longest win streak',     shape: 'kpi',       defaultRow: 1, component: LongestWinStreakWidget, config: EMPTY_SCHEMA          },
  { id: 'hero-pool-size',      eyebrow: 'Hero pool size',         shape: 'kpi',       defaultRow: 1, component: HeroPoolSizeWidget,     config: EMPTY_SCHEMA          },
  { id: 'best-winrate-hero',   eyebrow: 'Best hero by winrate',   shape: 'kpi',       defaultRow: 1, component: BestWinrateHeroWidget,  config: bestWinrateHeroSchema },
  { id: 'top-game-modes',       eyebrow: 'Most played game modes',  shape: 'breakdown', defaultRow: 2, component: TopGameModesWidget,      config: topGameModesSchema     },
  { id: 'time-of-day',         eyebrow: 'Time of day',            shape: 'breakdown', defaultRow: 2, component: TimeOfDayWidget,        config: timeOfDaySchema       },
  { id: 'day-of-week',         eyebrow: 'Day of week',            shape: 'breakdown', defaultRow: 2, component: DayOfWeekWidget,        config: dayOfWeekSchema       },
  { id: 'recent-5-matches',    eyebrow: 'Recent matches',         shape: 'breakdown', defaultRow: 2, component: Recent5MatchesWidget,   config: recentMatchesSchema   },
  { id: 'play-mode-share',     eyebrow: 'Quickplay vs Competitive', shape: 'breakdown', defaultRow: 2, component: QuickplayVsCompetitiveWidget, config: EMPTY_SCHEMA },
  { id: 'play-mode-winrate',   eyebrow: 'Winrate by play mode',     shape: 'breakdown', defaultRow: 2, component: WinrateByPlayModeWidget,      config: EMPTY_SCHEMA },
  { id: 'with-whom',           eyebrow: 'Win rate by teammate',   shape: 'breakdown', defaultRow: 2, component: WithWhomWidget,        config: withWhomSchema       },
  { id: 'current-rank',        eyebrow: 'Current rank',           shape: 'breakdown', defaultRow: 2, component: CurrentRankWidget,     config: EMPTY_SCHEMA          },
  { id: 'winrate-by-hero',     eyebrow: 'Win-rate by hero',       shape: 'breakdown', defaultRow: 2, component: WinrateByHeroWidget,  config: winrateBySchema       },
  { id: 'winrate-by-map',      eyebrow: 'Win-rate by map',        shape: 'breakdown', defaultRow: 2, component: WinrateByMapWidget,   config: winrateBySchema       },
  { id: 'winrate-by-role',     eyebrow: 'Win-rate by role',       shape: 'breakdown', defaultRow: 2, component: WinrateByRoleWidget,  config: winrateBySchema       },
]

// Row-keyed install-default layout. Membership here means "auto-add
// on first install" AND "re-add if missing from a user's stored
// layout" — widgets registered but absent from this map are opt-in
// via the customizer.
export const DEFAULT_ROW_LAYOUT: Readonly<Record<number, readonly string[]>> = {
  1: ['winrate', 'avg-kda', 'total-time', 'most-played-hero', 'reviewed-count', 'days-since-review', 'wld-since-review'],
  2: ['top-maps', 'top-heroes', 'top-roles'],
}

// Lookup helper. Returns undefined for unknown ids so callers can
// silently drop orphans from stored layouts.
const REGISTRY_BY_ID: ReadonlyMap<string, WidgetDef> = new Map(WIDGET_REGISTRY.map((w) => [w.id, w]))
export function widgetById(id: string): WidgetDef | undefined {
  return REGISTRY_BY_ID.get(id)
}
