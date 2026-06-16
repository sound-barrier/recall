<script setup lang="ts">
import { computed, ref, toRef } from 'vue'

import type { MatchRecord } from '@/api'
import { useOWData } from '@/composables/shared/useOWData'
import {
  aggOptionsFor,
  useMatchPivot,
  type PivotZone,
} from '@/composables/matches/useMatchPivot'
import type { PivotField } from '@/match/pivot-fields'
import { aggLabelOf } from '@/match/pivot-aggregate'
import PivotShelf from '@/components/matches/pivot/PivotShelf.vue'
import PivotCrosstab from '@/components/matches/pivot/PivotCrosstab.vue'
import PivotFieldChip, {
  type ChipAction,
  type ChipActPayload,
  type FilterOption,
} from '@/components/matches/pivot/PivotFieldChip.vue'

// The pivot builder + crosstab. Owns one useMatchPivot over the SAME
// narrowed records the flat data table reads, so flipping Flat↔Pivot never
// changes the underlying set. Drag a field chip between the Fields tray and
// the Rows / Columns / Values / Filters shelves to re-pivot live; every
// drag move also has a keyboard-driven menu equivalent on the chip.
const props = defineProps<{ records: MatchRecord[] }>()

const ow = useOWData()
const pivot = useMatchPivot(toRef(props, 'records'), ow.heroRole)

const liveMessage = ref('')
function announce(message: string) { liveMessage.value = message }

const ZONE_LABEL: Record<PivotZone, string> = {
  rows: 'Rows', columns: 'Columns', values: 'Values', filters: 'Filters',
}

const trayFields = computed(() => pivot.unusedFields.value)
const result = computed(() => pivot.result.value)

function metasOf(ids: string[]): PivotField[] {
  return ids.map((id) => pivot.byId.get(id)).filter((f): f is PivotField => f !== undefined)
}
const rowFields = computed(() => metasOf(pivot.config.value.rows))
const columnFields = computed(() => metasOf(pivot.config.value.columns))
const filterFields = computed(() => metasOf(pivot.config.value.filters.map((f) => f.field)))
const valueSpecs = computed(() => pivot.config.value.values.map((spec, index) => ({
  field: spec.field,
  label: pivot.byId.get(spec.field)?.label ?? spec.field,
  aggLabel: aggLabelOf(spec.agg),
  index,
})))

function labelOf(fieldId: string): string {
  return pivot.byId.get(fieldId)?.label ?? fieldId
}

// ── menu actions per chip ────────────────────────────────────────
function dimActions(location: PivotZone | 'tray'): ChipAction[] {
  const verb = location === 'tray' ? 'Add to' : 'Move to'
  const actions: ChipAction[] = (['rows', 'columns', 'filters'] as const)
    .filter((zone) => zone !== location)
    .map((zone) => ({ label: `${verb} ${ZONE_LABEL[zone]}`, payload: { type: 'assign', zone } }))
  if (location === 'rows' || location === 'columns') {
    actions.push({ label: 'Move up', payload: { type: 'move', delta: -1 } })
    actions.push({ label: 'Move down', payload: { type: 'move', delta: 1 } })
  }
  if (location !== 'tray') actions.push({ label: 'Remove', payload: { type: 'remove' } })
  return actions
}
const measureTrayActions: ChipAction[] = [{ label: 'Add to Values', payload: { type: 'assign', zone: 'values' } }]
function valueActions(fieldId: string): ChipAction[] {
  const actions: ChipAction[] = aggOptionsFor(fieldId).map((agg) => ({ label: aggLabelOf(agg), payload: { type: 'setAgg', agg } }))
  actions.push({ label: 'Move up', payload: { type: 'move', delta: -1 } })
  actions.push({ label: 'Move down', payload: { type: 'move', delta: 1 } })
  actions.push({ label: 'Remove', payload: { type: 'remove' } })
  return actions
}

// ── filter value picker ──────────────────────────────────────────
function distinctValues(fieldId: string): string[] {
  const dim = pivot.byId.get(fieldId)
  if (dim?.kind !== 'dimension') return []
  const set = new Set<string>()
  for (const rec of props.records) for (const v of dim.values(rec)) set.add(v)
  return [...set].sort()
}
function filterOptionsFor(fieldId: string): FilterOption[] {
  const all = distinctValues(fieldId)
  const filter = pivot.config.value.filters.find((f) => f.field === fieldId)
  const allowed = filter && filter.allowed.length > 0 ? new Set(filter.allowed) : null
  return all.map((value) => ({ value, checked: allowed === null || allowed.has(value) }))
}
function toggleFilterValue(fieldId: string, value: string) {
  const all = distinctValues(fieldId)
  const filter = pivot.config.value.filters.find((f) => f.field === fieldId)
  const current = filter && filter.allowed.length > 0 ? filter.allowed : all
  const set = new Set(current)
  if (set.has(value)) set.delete(value)
  else set.add(value)
  const next = [...set]
  pivot.setFilterAllowed(fieldId, next.length === all.length ? [] : next)
}

// ── drag + menu event handling ───────────────────────────────────
interface DragPayload { fieldId: string; from: PivotZone | 'tray'; index?: number }
function parsePayload(raw: string): DragPayload | null {
  try {
    const p = JSON.parse(raw) as DragPayload
    return p && typeof p.fieldId === 'string' ? p : null
  } catch { return null }
}
function onDrop(zone: PivotZone | 'tray', raw: string) {
  const p = parsePayload(raw)
  if (!p) return
  if (zone === 'tray') {
    if (p.from === 'values' && p.index !== undefined) pivot.removeValue(p.index)
    else pivot.removeField(p.fieldId)
    announce(`${labelOf(p.fieldId)} removed`)
    return
  }
  if (p.from === zone && zone !== 'values') return
  pivot.assignField(p.fieldId, zone)
  announce(`${labelOf(p.fieldId)} moved to ${ZONE_LABEL[zone]}`)
}
function onDimAct(fieldId: string, zone: PivotZone | 'tray', payload: ChipActPayload) {
  switch (payload.type) {
    case 'assign': pivot.assignField(fieldId, payload.zone); announce(`${labelOf(fieldId)} moved to ${ZONE_LABEL[payload.zone]}`); break
    case 'remove': pivot.removeField(fieldId); announce(`${labelOf(fieldId)} removed`); break
    case 'move': if (zone === 'rows' || zone === 'columns') pivot.moveField(fieldId, zone, payload.delta); break
    case 'toggleFilter': toggleFilterValue(fieldId, payload.value); break
    case 'filterReset': pivot.setFilterAllowed(fieldId, []); break
    default: break
  }
}
function onValueAct(index: number, payload: ChipActPayload) {
  switch (payload.type) {
    case 'setAgg': pivot.setValueAgg(index, payload.agg); break
    case 'remove': pivot.removeValue(index); break
    case 'move': pivot.moveValue(index, payload.delta); break
    default: break
  }
}
</script>

<template>
  <div class="pivot" data-testid="pivot-table">
    <p class="pivot-live" aria-live="polite">
      {{ liveMessage }}
    </p>

    <div class="pivot-builder">
      <PivotShelf
        zone="tray" label="Fields" :empty="trayFields.length === 0" hint="Every field is in use"
        @drop-field="(raw) => onDrop('tray', raw)"
      >
        <PivotFieldChip
          v-for="f in trayFields" :key="f.id"
          :field-id="f.id" :label="f.label" location="tray"
          :actions="f.kind === 'measure' ? measureTrayActions : dimActions('tray')"
          @act="(p) => onDimAct(f.id, 'tray', p)"
        />
      </PivotShelf>

      <div class="pivot-zones">
        <PivotShelf zone="rows" label="Rows" :empty="rowFields.length === 0" @drop-field="(raw) => onDrop('rows', raw)">
          <PivotFieldChip
            v-for="f in rowFields" :key="f.id"
            :field-id="f.id" :label="f.label" location="rows" :actions="dimActions('rows')"
            @act="(p) => onDimAct(f.id, 'rows', p)"
          />
        </PivotShelf>

        <PivotShelf zone="columns" label="Columns" :empty="columnFields.length === 0" @drop-field="(raw) => onDrop('columns', raw)">
          <PivotFieldChip
            v-for="f in columnFields" :key="f.id"
            :field-id="f.id" :label="f.label" location="columns" :actions="dimActions('columns')"
            @act="(p) => onDimAct(f.id, 'columns', p)"
          />
        </PivotShelf>

        <PivotShelf zone="values" label="Values" :empty="valueSpecs.length === 0" hint="Drag a measure here" @drop-field="(raw) => onDrop('values', raw)">
          <PivotFieldChip
            v-for="vs in valueSpecs" :key="vs.index"
            :field-id="vs.field" :label="vs.label" location="values" :index="vs.index"
            :agg-label="vs.aggLabel" :actions="valueActions(vs.field)"
            @act="(p) => onValueAct(vs.index, p)"
          />
        </PivotShelf>

        <PivotShelf zone="filters" label="Filters" :empty="filterFields.length === 0" hint="Drag a field to slice" @drop-field="(raw) => onDrop('filters', raw)">
          <PivotFieldChip
            v-for="f in filterFields" :key="f.id"
            :field-id="f.id" :label="f.label" location="filters" :actions="dimActions('filters')"
            :filter-options="filterOptionsFor(f.id)"
            @act="(p) => onDimAct(f.id, 'filters', p)"
          />
        </PivotShelf>
      </div>
    </div>

    <div class="pivot-toolbar">
      <span class="pivot-count">{{ result.recordCount }} {{ result.recordCount === 1 ? 'match' : 'matches' }}</span>
      <button type="button" class="pivot-reset" @click="pivot.resetPivot()">
        Reset pivot
      </button>
    </div>

    <PivotCrosstab :result="result" />
  </div>
</template>

<style scoped>
.pivot {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.5rem 0;
}

.pivot-live {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.pivot-builder {
  display: grid;
  grid-template-columns: minmax(9rem, 14rem) 1fr;
  gap: 0.6rem;
  align-items: start;
}

.pivot-zones {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.pivot-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.pivot-count {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.pivot-reset {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 0.3rem 0.6rem;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 3px;
  cursor: pointer;
}

.pivot-reset:hover {
  border-color: var(--accent);
  color: var(--accent);
}

@media (width <= 52rem) {
  .pivot-builder { grid-template-columns: 1fr; }
}
</style>
