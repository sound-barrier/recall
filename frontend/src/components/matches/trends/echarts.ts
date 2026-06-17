// Tree-shaken ECharts registration. Importing the `echarts` barrel
// pulls the entire chart/component/renderer catalog into the bundle;
// instead we register only the line chart + the grid/tooltip/legend/
// data-zoom/mark-line pieces the Trends section uses, against the
// canvas renderer. Every trend module imports ECharts (and the option
// type) from HERE so the registration runs exactly once.
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

import type { ComposeOption } from 'echarts/core'
import type { LineSeriesOption } from 'echarts/charts'
import type {
  GridComponentOption,
  TooltipComponentOption,
  LegendComponentOption,
  MarkLineComponentOption,
} from 'echarts/components'

use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  CanvasRenderer,
])

// The exact option shape our charts can build — the union of only the
// registered pieces, so the compiler rejects any config that depends on
// an unregistered component.
export type TrendOption = ComposeOption<
  | LineSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | MarkLineComponentOption
>
