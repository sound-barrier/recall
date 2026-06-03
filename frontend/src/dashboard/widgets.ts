import type { Component } from 'vue'
import WinrateWidget from '../components/widgets/WinrateWidget.vue'
import AvgKdaWidget from '../components/widgets/AvgKdaWidget.vue'
import TotalTimePlayedWidget from '../components/widgets/TotalTimePlayedWidget.vue'
import MostPlayedHeroWidget from '../components/widgets/MostPlayedHeroWidget.vue'
import MatchesReviewedWidget from '../components/widgets/MatchesReviewedWidget.vue'
import DaysSinceReviewWidget from '../components/widgets/DaysSinceReviewWidget.vue'
import WldSinceReviewWidget from '../components/widgets/WldSinceReviewWidget.vue'
import TopMapsWidget from '../components/widgets/TopMapsWidget.vue'
import TopHeroesWidget from '../components/widgets/TopHeroesWidget.vue'
import TopRolesWidget from '../components/widgets/TopRolesWidget.vue'
// PR B opt-in widgets. Registered here but NOT included in
// DEFAULT_ROW_LAYOUT — they only appear on a user's dossier after
// the user explicitly adds them via the customizer.
import CurrentStreakWidget from '../components/widgets/CurrentStreakWidget.vue'
import LongestWinStreakWidget from '../components/widgets/LongestWinStreakWidget.vue'
import HeroPoolSizeWidget from '../components/widgets/HeroPoolSizeWidget.vue'
import BestWinrateHeroWidget from '../components/widgets/BestWinrateHeroWidget.vue'
import TopMapTypesWidget from '../components/widgets/TopMapTypesWidget.vue'
import TimeOfDayWidget from '../components/widgets/TimeOfDayWidget.vue'
import DayOfWeekWidget from '../components/widgets/DayOfWeekWidget.vue'
import Recent5MatchesWidget from '../components/widgets/Recent5MatchesWidget.vue'

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

export interface WidgetDef {
  id:        string
  eyebrow:   string
  shape:     WidgetShape
  defaultRow: number
  component: Component
}

export const WIDGET_REGISTRY: readonly WidgetDef[] = [
  { id: 'winrate',           eyebrow: 'Winrate',                      shape: 'kpi',       defaultRow: 1, component: WinrateWidget         },
  { id: 'avg-kda',           eyebrow: 'Avg K/D/A per 10min',          shape: 'kpi',       defaultRow: 1, component: AvgKdaWidget          },
  { id: 'total-time',        eyebrow: 'Total time played',            shape: 'kpi',       defaultRow: 1, component: TotalTimePlayedWidget },
  { id: 'most-played-hero',  eyebrow: 'Most played hero',             shape: 'kpi',       defaultRow: 1, component: MostPlayedHeroWidget  },
  { id: 'reviewed-count',    eyebrow: 'Matches reviewed',             shape: 'kpi',       defaultRow: 1, component: MatchesReviewedWidget },
  { id: 'days-since-review', eyebrow: 'Days since last review',       shape: 'kpi',       defaultRow: 1, component: DaysSinceReviewWidget },
  { id: 'wld-since-review',  eyebrow: 'W / L / D since last review',  shape: 'kpi',       defaultRow: 1, component: WldSinceReviewWidget  },
  { id: 'top-maps',          eyebrow: 'Most played maps',             shape: 'breakdown', defaultRow: 2, component: TopMapsWidget         },
  { id: 'top-heroes',        eyebrow: 'Most played heroes',           shape: 'breakdown', defaultRow: 2, component: TopHeroesWidget       },
  { id: 'top-roles',         eyebrow: 'Most played roles',            shape: 'breakdown', defaultRow: 2, component: TopRolesWidget        },
  // PR B opt-in widgets (NOT in DEFAULT_ROW_LAYOUT).
  { id: 'current-streak',      eyebrow: 'Current streak',         shape: 'kpi',       defaultRow: 1, component: CurrentStreakWidget    },
  { id: 'longest-win-streak',  eyebrow: 'Longest win streak',     shape: 'kpi',       defaultRow: 1, component: LongestWinStreakWidget },
  { id: 'hero-pool-size',      eyebrow: 'Hero pool size',         shape: 'kpi',       defaultRow: 1, component: HeroPoolSizeWidget     },
  { id: 'best-winrate-hero',   eyebrow: 'Best hero by winrate',   shape: 'kpi',       defaultRow: 1, component: BestWinrateHeroWidget  },
  { id: 'top-map-types',       eyebrow: 'Most played map types',  shape: 'breakdown', defaultRow: 2, component: TopMapTypesWidget      },
  { id: 'time-of-day',         eyebrow: 'Time of day',            shape: 'breakdown', defaultRow: 2, component: TimeOfDayWidget        },
  { id: 'day-of-week',         eyebrow: 'Day of week',            shape: 'breakdown', defaultRow: 2, component: DayOfWeekWidget        },
  { id: 'recent-5-matches',    eyebrow: 'Recent matches',         shape: 'breakdown', defaultRow: 2, component: Recent5MatchesWidget   },
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
