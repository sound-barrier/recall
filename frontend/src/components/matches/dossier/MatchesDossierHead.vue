<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'

import type { MatchRecord } from '@/api-client'
import type { useMatchesNarrow } from '@/composables/matches/useMatchesNarrow'
import type { NarrowMode } from '@/composables/matches/useNarrowMode'
import { useDashboardGrid } from '@/composables/dashboard/useDashboardGrid'
import MatchesDossier from '@/components/matches/dossier/MatchesDossier.vue'
import DashboardWidget from '@/components/dashboard/DashboardWidget.vue'
import DossierManageMenu from '@/components/matches/dossier/DossierManageMenu.vue'
import DashboardUndoToast from '@/components/dashboard/DashboardUndoToast.vue'
import WidgetConfigPopover from '@/components/dashboard/WidgetConfigPopover.vue'
// NarrowPopover is the heavyweight authoring surface (search + combobox
// + range pickers + active-clause range). Lazy-load it so the dossier
// head's chunk doesn't carry its ~14K of JS / ~12K of CSS; the popover
// only mounts (v-if inside the child) when the user clicks "Filter
// matches". MatchesView lazy-loads its own rail-mode instance the same
// way. Regression covered by MatchesDossierHead.lazy-views.test.ts.
const NarrowPopover = defineAsyncComponent(() => import('@/components/matches/narrow/NarrowPopover.vue'))

// The dossier "head" chrome: the set summary (MatchesDossier), the
// customizable widget grid (drag-reorder + live-reflow preview + undo +
// per-widget config), the Add menu, and the popover-mode narrow trigger.
// The widgets read the shared dossier via useDossier() inject (provided
// by MatchesView), so this component only needs the narrow bundle + the
// full corpus to render the headline/subline/anchor chip and to seed the
// narrow popover.
const props = defineProps<{
  narrow: ReturnType<typeof useMatchesNarrow>
  records: MatchRecord[]
  // Rail vs popover. In popover mode this component renders the
  // "Filter matches" trigger + modal; in rail mode MatchesView renders
  // the always-open peer column instead and this trigger is hidden.
  narrowMode: NarrowMode
}>()

const emit = defineEmits<{
  'open-match': [matchKey: string]
  'clear-anchor': []
  'narrow-open': [open: boolean]
}>()

const {
  searchText,
  pickedMaps, pickedGameModes, pickedHeroes, pickedRoles, pickedResults, pickedTags, pickedMembers,
  pickedRange, customFrom, customTo,
  anchorKey,
  activeClauseCount, anyNarrow,
  narrowedRecords,
} = props.narrow

// "Reset filter" surfaces the date-range clear on the dossier itself so the
// user needn't open the Filter-matches panel just to drop a Campaign Log
// selection. Scoped to the date range only — pickRange('all') clears
// customFrom / customTo; the other narrow dimensions are left untouched.
const hasDateRange = computed(
  () => Boolean(customFrom.value) || Boolean(customTo.value) || pickedRange.value !== 'all',
)
function resetDateRange() {
  props.narrow.pickRange('all')
}

// ─── Dashboard widget layout ────────────────────────────────────
// The customizable widget grid — persisted row layout, the live-reflow
// drag-reorder preview, the trash→undo registry, and the per-widget settings
// popover anchor — lives in useDashboardGrid. The template below renders its
// returned state exactly as before.
const {
  dashboardRows,
  dragReorder,
  showManageMenu,
  configureWidgetId,
  configureAnchor,
  configureDef,
  onWidgetConfigure,
  closeWidgetConfigure,
  pendingUndo,
  onWidgetRemove,
  onUndoRemove,
  onDismissUndo,
  LEGACY_DATA_KPI,
  LEGACY_DATA_BREAKDOWN,
} = useDashboardGrid()

// ─── Set summary headline / subline / anchor chip ──────────────
const setHeadline = computed(() => {
  if (!anyNarrow.value) return 'All matches on record'
  const parts: string[] = []
  if (searchText.value.trim()) parts.push(`"${searchText.value.trim()}"`)
  if (customFrom.value || customTo.value) parts.push(`${customFrom.value || '…'} → ${customTo.value || '…'}`)
  else if (pickedRange.value !== 'all') parts.push(`last ${pickedRange.value}`)
  if (pickedGameModes.value.size) parts.push([...pickedGameModes.value].join('/'))
  if (pickedMaps.value.size)     parts.push([...pickedMaps.value].join(' · '))
  if (pickedRoles.value.size)    parts.push([...pickedRoles.value].join('/'))
  if (pickedHeroes.value.size)   parts.push([...pickedHeroes.value].join(' · '))
  if (pickedResults.value.size)  parts.push([...pickedResults.value].join('/'))
  if (pickedTags.value.size)     parts.push([...pickedTags.value].map((t) => `#${t}`).join(' '))
  if (pickedMembers.value.size)  parts.push('with ' + [...pickedMembers.value].join(' + '))
  return parts.join(' — ') || 'Active narrow'
})

const setSubline = computed(() => {
  const n = narrowedRecords.value.length
  if (!anyNarrow.value) return 'spans your full history'
  return `${n} of ${props.records.length} matches in this view`
})

// "Since anchor" — look up the anchored match from the full corpus (NOT
// narrowedRecords, which excludes the anchor itself when the filter is
// active). Returns null when the anchor key is unset OR points at a
// deleted match. Drives both the active-chip label and the narrow-panel
// section copy.
const anchorRecord = computed(() => {
  if (anchorKey.value === '') return null
  return props.records.find((r) => r.match_key === anchorKey.value) ?? null
})

const anchorChipLabel = computed(() => {
  const r = anchorRecord.value
  if (!r) return ''
  const d = r.data?.date ?? ''
  const map = r.data?.map ?? '—'
  return d ? `${d} · ${map}` : map
})

// ─── Narrow popover trigger (popover mode) ─────────────────────
//
// The popover itself (template + focus trap + outside-click handler +
// '/' keyboard shortcut + combobox state) lives in NarrowPopover.vue —
// all that's left here is the trigger button + the open ref + the
// trigger ref the popover needs for the outside-click exemption.
const narrowOpen = ref(false)
const triggerRef = ref<HTMLElement | null>(null)

function toggleNarrow() {
  narrowOpen.value = !narrowOpen.value
}
</script>

<template>
  <section
    class="set-dossier"
    aria-label="Set dossier"
  >
    <MatchesDossier
      :narrow="props.narrow"
      :set-headline="setHeadline"
      :set-subline="setSubline"
      :anchor-record="anchorRecord"
      :anchor-chip-label="anchorChipLabel"
    />

    <template v-for="row in dashboardRows" :key="`row-${row.index}`">
      <TransitionGroup
        tag="div"
        class="dashboard-row"
        name="dashboard-widget"
        :data-row="row.index"
        @dragover.prevent="dragReorder.onRowDragOver(row.index, $event)"
        @drop="dragReorder.onRowDrop(row.index, $event)"
      >
        <DashboardWidget
          v-for="(def, idx) in row.widgets"
          :id="def.id"
          :key="def.id"
          :shape="def.shape"
          :row="row.index"
          :idx="idx"
          :has-config="def.config.fields.length > 0"
          :dragging="dragReorder.dragging.value !== null
            && dragReorder.dragging.value.id === def.id"
          :drop-target="dragReorder.dropHint.value !== null &&
            dragReorder.dropHint.value.row === row.index &&
            dragReorder.dropHint.value.idx === idx"
          :legacy-data-kpi="LEGACY_DATA_KPI[def.id]"
          :legacy-data-breakdown="LEGACY_DATA_BREAKDOWN[def.id]"
          @drag-start="dragReorder.onDragStart"
          @drag-end="dragReorder.onDragEnd"
          @drag-over="dragReorder.onDragOver"
          @drop="dragReorder.onDrop"
          @handle-keydown="dragReorder.onHandleKeydown"
          @remove="onWidgetRemove"
          @configure="onWidgetConfigure"
        >
          <component :is="def.component" />
        </DashboardWidget>
      </TransitionGroup>
    </template>

    <!-- Narrow trigger + Add/Reset menu. -->
    <div class="dossier-actions">
      <!-- Add menu — the only customization surface left now that
         remove + reorder live inline on each widget/section. A small
         dropdown of removed widgets + sections to re-add, plus Reset. -->
      <div class="dossier-manage-anchor">
        <button
          type="button"
          class="dossier-btn"
          :class="{ 'is-open': showManageMenu }"
          data-dossier-add
          :aria-expanded="showManageMenu ? 'true' : 'false'"
          aria-haspopup="dialog"
          @click="showManageMenu = !showManageMenu"
        >
          <span aria-hidden="true">＋</span> Add
        </button>
        <DossierManageMenu :open="showManageMenu" @close="showManageMenu = false" />
      </div>

      <!-- Popover-mode trigger + modal. Hidden when the rail is
         rendering instead (>= 1400 px viewport). -->
      <div v-if="props.narrowMode === 'popover'" class="narrow-anchor">
        <button
          ref="triggerRef"
          class="dossier-btn primary"
          :class="{ 'is-open': narrowOpen }"
          :aria-expanded="narrowOpen ? 'true' : 'false'"
          aria-haspopup="true"
          aria-controls="narrow-popover"
          data-narrow-trigger
          @click="toggleNarrow"
        >
          <span aria-hidden="true">⌗</span> Filter matches
          <span v-if="anyNarrow" class="narrow-count">· {{ activeClauseCount }}</span>
        </button>

        <NarrowPopover
          v-model:open="narrowOpen"
          mode="popover"
          :narrow="props.narrow"
          :records="props.records"
          :trigger-el="triggerRef"
          @open-match="(k: string) => emit('open-match', k)"
          @clear-anchor="emit('clear-anchor')"
          @narrow-open="(v: boolean) => emit('narrow-open', v)"
        />
      </div>

      <button
        v-if="hasDateRange"
        type="button"
        class="dossier-btn"
        data-reset-filter
        title="Clear the selected date range"
        @click="resetDateRange"
      >
        <span aria-hidden="true">⨯</span> Reset filter
      </button>
    </div>

    <!-- Undo-after-trash toast. Itself teleports to <body> so it lives
       outside any inert/aria-hidden ancestors. -->
    <DashboardUndoToast
      :trashed="pendingUndo"
      @undo="onUndoRemove"
      @dismiss="onDismissUndo"
    />

    <!-- Per-widget settings popover. Teleports to <body>; anchored to
       the gear-button rect captured on click. -->
    <WidgetConfigPopover
      :open="configureWidgetId !== null"
      :def="configureDef"
      :anchor="configureAnchor"
      @close="closeWidgetConfigure"
    />
  </section>
</template>

<style scoped>
/* ─── Dossier ──────────────────────────────────────────────── */

.set-dossier {
  background:
    repeating-linear-gradient(
      135deg,
      color-mix(in srgb, var(--accent) 3%, transparent) 0,
      color-mix(in srgb, var(--accent) 3%, transparent) 10px,
      transparent 10px,
      transparent 20px
    ),
    var(--surface);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 1rem 1.2rem 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  position: relative;
}

.set-dossier::before {
  content: '';
  position: absolute;
  left: 0; top: 0;
  width: 4px; height: 100%;
  background: var(--accent);
  border-radius: 2px 0 0 2px;
}

/* Shape-agnostic widget row. Each row is a flex grid of
   `<DashboardWidget>` cells of mixed shapes; auto-fit + a wider
   min-width on `.breakdown` lets KPI tiles and breakdown articles
   coexist (breakdown cells claim more width to render their bar
   visualization legibly).

   The tile/breakdown CHROME (border, padding, background) lives in
   DashboardWidget.vue's scoped block. Everything else (`.kpi-*` /
   `.breakdown-*` / `.bd-*`) was promoted to app.css since 10 widget SFCs
   reference them. */
.dashboard-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.5rem;
  align-items: start;

  /* Defensive: keep any descendant `position: absolute` (e.g. a
     mid-transition leave-active widget, mid-drag ghost overlay) confined
     to the row's box instead of escaping up to .set-dossier and
     overlapping the header / sibling rows. */
  position: relative;
}

/* Breakdown widgets need more room than KPI tiles to render their bar
   visualization (map/hero labels + bar + share %). Span 2 grid tracks
   instead of setting `min-width: 280px` on the cell — `min-width` on a
   grid child forces the track to grow past the `minmax(180px, 1fr)`
   calculation, which collides with the auto-fit track count when the row
   also holds KPIs. The result was visual overlap on dense rows. Spanning
   2 tracks keeps the breakdown wide enough for its bars while staying
   inside the grid's track budget — auto-fit clamps the span to the
   available track count at narrow widths, so a 320px viewport still
   renders cleanly. */
.dashboard-row :deep(.breakdown) {
  grid-column: span 2;
}

.dossier-actions { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.2rem; }

/* Anchors the Add dropdown below the Add button. */
.dossier-manage-anchor { position: relative; }

/* ── Widget enter / exit animation ──────────────────────────
   Wraps every .dashboard-row in <TransitionGroup>; new widgets scale-in
   from 0.94 with a fade, removed widgets scale-out while shrinking their
   box. The v-move transition handles same-row sibling shifts during
   drags + reorders.

   We deliberately do NOT use `position: absolute` on leave-active. That
   technique made siblings reflow instantly into the gap but escaped the
   leaving widget from its grid track — without a positioned ancestor it
   floated up to .set-dossier and overlapped the dossier header. The
   "shrink in place" alternative keeps the cell width during the 240 ms
   leave, which reads as a deliberate fade-out rather than a broken
   layout. */
.dashboard-widget-enter-active,
.dashboard-widget-leave-active,
.dashboard-widget-move {
  transition: opacity 220ms ease,
              transform 240ms cubic-bezier(0.2, 0.7, 0.3, 1),
              max-width 220ms cubic-bezier(0.2, 0.7, 0.3, 1),
              margin 220ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

.dashboard-widget-leave-active {
  pointer-events: none;
}

.dashboard-widget-enter-from,
.dashboard-widget-leave-to {
  opacity: 0;
  transform: scale(0.94);
}

@media (prefers-reduced-motion: reduce) {
  .dashboard-widget-enter-active,
  .dashboard-widget-leave-active,
  .dashboard-widget-move { transition: none; }
}

.dossier-btn {
  appearance: none;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.45rem 0.9rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-dim);
  cursor: pointer;
  font-weight: 700;
}

.dossier-btn.primary {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-color: var(--accent);
  color: var(--accent);
}

.dossier-btn.primary.is-open {
  background: var(--accent);
  color: var(--surface);
}

.dossier-btn:hover { border-color: var(--accent); color: var(--accent); }
.dossier-btn.primary.is-open:hover { color: var(--surface); }

.narrow-count { color: inherit; font-weight: 700; }

/* ─── Narrow popover ───────────────────────────────────────── */

.narrow-anchor { position: relative; }
</style>
