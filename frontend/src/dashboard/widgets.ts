import type { Component } from 'vue'
import { EMPTY_SCHEMA, type WidgetConfigSchema } from '@/dashboard/widget-config-schema'
import {
  bestWinrateHeroSchema,
  climbVelocitySchema,
  dayOfWeekSchema,
  formDeltaSchema,
  heroDisciplineSchema,
  lossStreakRecoverySchema,
  mostPlayedHeroSchema,
  perfVsRankSchema,
  recentMatchesSchema,
  rollingBaselineSchema,
  timeOfDaySchema,
  topGameModesSchema,
  topHeroesSchema,
  topMapsSchema,
  totalTimeSchema,
  winrateBySchema,
  withWhomSchema,
} from '@/dashboard/widget-schemas'
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
import RankPercentileWidget from '@/components/dashboard/widgets/RankPercentileWidget.vue'
import WinrateByHeroWidget from '@/components/dashboard/widgets/WinrateByHeroWidget.vue'
import WinrateByMapWidget from '@/components/dashboard/widgets/WinrateByMapWidget.vue'
import WinrateByRoleWidget from '@/components/dashboard/widgets/WinrateByRoleWidget.vue'
import TiltCheckWidget from '@/components/dashboard/widgets/TiltCheckWidget.vue'
import TiltQueuesWidget from '@/components/dashboard/widgets/TiltQueuesWidget.vue'
import FirstGameWinrateWidget from '@/components/dashboard/widgets/FirstGameWinrateWidget.vue'
import NetRankWeekWidget from '@/components/dashboard/widgets/NetRankWeekWidget.vue'
import AvgGameLengthWidget from '@/components/dashboard/widgets/AvgGameLengthWidget.vue'
import LeaverRateWidget from '@/components/dashboard/widgets/LeaverRateWidget.vue'
import SessionsWidget from '@/components/dashboard/widgets/SessionsWidget.vue'
import ModifierBreakdownWidget from '@/components/dashboard/widgets/ModifierBreakdownWidget.vue'
import FocusNowWidget from '@/components/dashboard/widgets/FocusNowWidget.vue'
import LossQualityWidget from '@/components/dashboard/widgets/LossQualityWidget.vue'
import UphillBattleWidget from '@/components/dashboard/widgets/UphillBattleWidget.vue'
import ReversalWidget from '@/components/dashboard/widgets/ReversalWidget.vue'
import HeroesPerMatchWidget from '@/components/dashboard/widgets/HeroesPerMatchWidget.vue'
import FormDeltaWidget from '@/components/dashboard/widgets/FormDeltaWidget.vue'
import PerfVsRankWidget from '@/components/dashboard/widgets/PerfVsRankWidget.vue'
import RollingBaselineWidget from '@/components/dashboard/widgets/RollingBaselineWidget.vue'
import ClimbVelocityWidget from '@/components/dashboard/widgets/ClimbVelocityWidget.vue' 
import LossStreakRecoveryWidget from '@/components/dashboard/widgets/LossStreakRecoveryWidget.vue'
import SessionDepthWidget from '@/components/dashboard/widgets/SessionDepthWidget.vue'

// Central registry for the dossier's customizable dashboard widgets.
//
// `shape` drives the wrapper chrome (.kpi-tile or .breakdown). It's the
// widget's intrinsic visual footprint — orthogonal to which row it
// lives in. `defaultRow` is the INITIAL row assignment when the user
// adds the widget via the customizer; user customization can move it
// to any row.
//
// `DEFAULT_ROW_LAYOUT` is the source of truth for "what ships visible
// on first install". A widget that lives in `WIDGET_REGISTRY` but NOT
// in `DEFAULT_ROW_LAYOUT` is opt-in only — it shows up in the
// customizer's "+ Add" gallery but never appears on a user's dossier
// until they explicitly add it. A stored layout is authoritative:
// the reconciler never re-adds absent defaults.
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
  { id: 'hero-pool-size',      eyebrow: 'Hero pool size',         shape: 'kpi',       defaultRow: 1, component: HeroPoolSizeWidget,     config: heroDisciplineSchema  },
  { id: 'best-winrate-hero',   eyebrow: 'Best hero by winrate',   shape: 'kpi',       defaultRow: 1, component: BestWinrateHeroWidget,  config: bestWinrateHeroSchema },
  { id: 'top-game-modes',       eyebrow: 'Most played game modes',  shape: 'breakdown', defaultRow: 2, component: TopGameModesWidget,      config: topGameModesSchema     },
  { id: 'time-of-day',         eyebrow: 'Time of day',            shape: 'breakdown', defaultRow: 2, component: TimeOfDayWidget,        config: timeOfDaySchema       },
  { id: 'day-of-week',         eyebrow: 'Day of week',            shape: 'breakdown', defaultRow: 2, component: DayOfWeekWidget,        config: dayOfWeekSchema       },
  { id: 'recent-5-matches',    eyebrow: 'Recent matches',         shape: 'breakdown', defaultRow: 2, component: Recent5MatchesWidget,   config: recentMatchesSchema   },
  { id: 'play-mode-share',     eyebrow: 'Quickplay vs Competitive', shape: 'breakdown', defaultRow: 2, component: QuickplayVsCompetitiveWidget, config: EMPTY_SCHEMA },
  { id: 'play-mode-winrate',   eyebrow: 'Winrate by play mode',     shape: 'breakdown', defaultRow: 2, component: WinrateByPlayModeWidget,      config: EMPTY_SCHEMA },
  { id: 'with-whom',           eyebrow: 'Win rate by teammate',   shape: 'breakdown', defaultRow: 2, component: WithWhomWidget,        config: withWhomSchema       },
  { id: 'current-rank',        eyebrow: 'Current rank',           shape: 'breakdown', defaultRow: 2, component: CurrentRankWidget,     config: EMPTY_SCHEMA          },
  { id: 'rank-percentile',     eyebrow: 'Ranked above',           shape: 'breakdown', defaultRow: 2, component: RankPercentileWidget,  config: EMPTY_SCHEMA          },
  { id: 'winrate-by-hero',     eyebrow: 'Win-rate by hero',       shape: 'breakdown', defaultRow: 2, component: WinrateByHeroWidget,  config: winrateBySchema       },
  { id: 'winrate-by-map',      eyebrow: 'Win-rate by map',        shape: 'breakdown', defaultRow: 2, component: WinrateByMapWidget,   config: winrateBySchema       },
  { id: 'winrate-by-role',     eyebrow: 'Win-rate by role',       shape: 'breakdown', defaultRow: 2, component: WinrateByRoleWidget,  config: winrateBySchema       },
  { id: 'tilt-check',          eyebrow: 'Win-rate after a loss',  shape: 'kpi',       defaultRow: 1, component: TiltCheckWidget,       config: EMPTY_SCHEMA          },
  { id: 'tilt-queues',         eyebrow: 'Tilt queues',            shape: 'kpi',       defaultRow: 1, component: TiltQueuesWidget,      config: EMPTY_SCHEMA          },
  { id: 'first-game-winrate',  eyebrow: 'First game of session',  shape: 'kpi',       defaultRow: 1, component: FirstGameWinrateWidget, config: EMPTY_SCHEMA          },
  { id: 'net-rank-week',       eyebrow: 'Net rank (7 days)',      shape: 'kpi',       defaultRow: 1, component: NetRankWeekWidget,     config: EMPTY_SCHEMA          },
  { id: 'avg-game-length',     eyebrow: 'Avg game length',        shape: 'kpi',       defaultRow: 1, component: AvgGameLengthWidget,    config: EMPTY_SCHEMA          },
  { id: 'leaver-rate',         eyebrow: 'Leaver rate',            shape: 'kpi',       defaultRow: 1, component: LeaverRateWidget,      config: EMPTY_SCHEMA          },
  { id: 'sessions',            eyebrow: 'Play sessions',          shape: 'kpi',       defaultRow: 1, component: SessionsWidget,        config: EMPTY_SCHEMA          },
  { id: 'modifier-breakdown',  eyebrow: 'Match modifiers',        shape: 'breakdown', defaultRow: 2, component: ModifierBreakdownWidget, config: EMPTY_SCHEMA       },
  { id: 'loss-quality',        eyebrow: 'Loss quality',           shape: 'breakdown', defaultRow: 2, component: LossQualityWidget,      config: EMPTY_SCHEMA       },
  { id: 'focus-now',           eyebrow: "What you're working on", shape: 'breakdown', defaultRow: 2, component: FocusNowWidget,        config: EMPTY_SCHEMA       },
  { id: 'uphill-battle',       eyebrow: 'Uphill battles',         shape: 'kpi',       defaultRow: 1, component: UphillBattleWidget,    config: EMPTY_SCHEMA          },
  { id: 'reversal',            eyebrow: 'Reversals',              shape: 'kpi',       defaultRow: 1, component: ReversalWidget,        config: EMPTY_SCHEMA          },
  { id: 'heroes-per-match',    eyebrow: 'Heroes per match',       shape: 'breakdown', defaultRow: 2, component: HeroesPerMatchWidget,  config: heroDisciplineSchema  },
  { id: 'perf-vs-rank',         eyebrow: 'Play vs rank',           shape: 'kpi',       defaultRow: 1, component: PerfVsRankWidget,         config: perfVsRankSchema         },
  { id: 'rolling-baseline',     eyebrow: 'Vs your baseline',       shape: 'kpi',       defaultRow: 1, component: RollingBaselineWidget,    config: rollingBaselineSchema    },
  { id: 'climb-velocity',       eyebrow: 'Climb rate',             shape: 'kpi',       defaultRow: 1, component: ClimbVelocityWidget,      config: climbVelocitySchema      },
  { id: 'form-delta',           eyebrow: 'Recent form',            shape: 'kpi',       defaultRow: 1, component: FormDeltaWidget,          config: formDeltaSchema          },
  { id: 'loss-streak-recovery', eyebrow: 'After a loss streak',    shape: 'kpi',       defaultRow: 1, component: LossStreakRecoveryWidget, config: lossStreakRecoverySchema },
  { id: 'session-depth',        eyebrow: 'Session depth',          shape: 'breakdown', defaultRow: 2, component: SessionDepthWidget,       config: EMPTY_SCHEMA             },
]

// Row-keyed install-default layout — what a fresh install renders.
// Widgets registered but absent from this map are opt-in via the
// customizer's "+ Add" gallery. Once a user has a stored layout it is
// authoritative: the reconciler drops orphans but never re-adds
// absent defaults (see useDashboardLayout), so changing this map only
// affects fresh installs — plus whatever a one-shot layout migration
// explicitly re-seeds.
//
// The climb-focused default: row 1 answers "am I climbing right now"
// (rate, form, velocity, streak, tilt, output); row 2 answers "what
// am I good at" (rank + winrate-judged breakdowns). Volume and
// review-workflow widgets live in the gallery.
export const DEFAULT_ROW_LAYOUT: Readonly<Record<number, readonly string[]>> = {
  1: ['winrate', 'form-delta', 'net-rank-week', 'perf-vs-rank', 'current-streak', 'tilt-check', 'avg-kda'],
  2: ['current-rank', 'rank-percentile', 'winrate-by-hero', 'winrate-by-map', 'winrate-by-role'],
}

// Lookup helper. Returns undefined for unknown ids so callers can
// silently drop orphans from stored layouts.
const REGISTRY_BY_ID: ReadonlyMap<string, WidgetDef> = new Map(WIDGET_REGISTRY.map((w) => [w.id, w]))
export function widgetById(id: string): WidgetDef | undefined {
  return REGISTRY_BY_ID.get(id)
}
