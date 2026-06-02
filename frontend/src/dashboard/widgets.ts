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

// Central registry for the dossier's customizable dashboard widgets.
//
// `shape` drives the wrapper chrome (.kpi-tile or .breakdown). It's the
// widget's intrinsic visual footprint — orthogonal to which row it
// lives in. `defaultRow` is the INITIAL row assignment; user
// customization (Phase 3) can move a widget to any row.
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
  // Reserved for forward-compat: a widget shipped with defaultVisible:false
  // would land hidden by default. No widget uses that today.
  defaultVisible: boolean
}

export const WIDGET_REGISTRY: readonly WidgetDef[] = [
  { id: 'winrate',           eyebrow: 'Winrate',                      shape: 'kpi',       defaultRow: 1, component: WinrateWidget,         defaultVisible: true },
  { id: 'avg-kda',           eyebrow: 'Avg K/D/A per 10min',          shape: 'kpi',       defaultRow: 1, component: AvgKdaWidget,          defaultVisible: true },
  { id: 'total-time',        eyebrow: 'Total time played',            shape: 'kpi',       defaultRow: 1, component: TotalTimePlayedWidget, defaultVisible: true },
  { id: 'most-played-hero',  eyebrow: 'Most played hero',             shape: 'kpi',       defaultRow: 1, component: MostPlayedHeroWidget,  defaultVisible: true },
  { id: 'reviewed-count',    eyebrow: 'Matches reviewed',             shape: 'kpi',       defaultRow: 1, component: MatchesReviewedWidget, defaultVisible: true },
  { id: 'days-since-review', eyebrow: 'Days since last review',       shape: 'kpi',       defaultRow: 1, component: DaysSinceReviewWidget, defaultVisible: true },
  { id: 'wld-since-review',  eyebrow: 'W / L / D since last review',  shape: 'kpi',       defaultRow: 1, component: WldSinceReviewWidget,  defaultVisible: true },
  { id: 'top-maps',          eyebrow: 'Most played maps',             shape: 'breakdown', defaultRow: 2, component: TopMapsWidget,         defaultVisible: true },
  { id: 'top-heroes',        eyebrow: 'Most played heroes',           shape: 'breakdown', defaultRow: 2, component: TopHeroesWidget,       defaultVisible: true },
  { id: 'top-roles',         eyebrow: 'Most played roles',            shape: 'breakdown', defaultRow: 2, component: TopRolesWidget,        defaultVisible: true },
]

// Row-keyed default layout. Adding row 3 in Phase 4 = one new entry
// here; nothing downstream hardcodes the row count.
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
