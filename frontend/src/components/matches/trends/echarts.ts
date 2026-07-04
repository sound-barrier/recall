// Tree-shaken ECharts registration. Importing the `echarts` barrel
// pulls the entire chart/component/renderer catalog into the bundle;
// instead we register only the pieces the Trends section uses — line +
// bar charts, the grid/tooltip/legend/mark-line/data-zoom/brush
// components — against the canvas renderer. Every trend module imports
// ECharts (and the option type) from HERE so the registration runs once.
import { use } from 'echarts/core'
import { LineChart, BarChart, HeatmapChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  DataZoomComponent,
  BrushComponent,
  VisualMapComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

import type { ComposeOption } from 'echarts/core'
import type { LineSeriesOption, BarSeriesOption, HeatmapSeriesOption } from 'echarts/charts'
import type {
  GridComponentOption,
  TooltipComponentOption,
  LegendComponentOption,
  MarkLineComponentOption,
  DataZoomComponentOption,
  BrushComponentOption,
  VisualMapComponentOption,
} from 'echarts/components'

use([
  LineChart,
  BarChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  DataZoomComponent,
  BrushComponent,
  VisualMapComponent,
  CanvasRenderer,
])

// The exact option shape our charts can build — the union of only the
// registered pieces, so the compiler rejects any config that depends on
// an unregistered component.
export type TrendOption = ComposeOption<
  | LineSeriesOption
  | BarSeriesOption
  | HeatmapSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | MarkLineComponentOption
  | DataZoomComponentOption
  | BrushComponentOption
  | VisualMapComponentOption
>
