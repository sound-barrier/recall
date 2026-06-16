<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import {
  useTableSort,
  TABLE_SORT_COLUMNS,
  type TableSortCol,
} from '@/composables/matches/useTableSort'
import { useModalFocusTrap } from '@/composables/shared/useModalFocusTrap'

// Excel-style "Custom sort" dialog for the Data-density table: the
// ordered list of sort levels, each with an editable column + direction,
// plus reorder / remove, Add level, and Reset. Anchored under the
// members-head sort trigger (MatchesView owns open + anchor).
//
// Mutations flow into this component's OWN useTableSort instance; the
// table's instance re-hydrates through usePersistedRef's
// `recall-pref-changed` broadcast, so the rows re-sort without a
// parent-level write path — the same seam the widget-config popover uses.

const props = defineProps<{
  open: boolean
  // Trigger's bounding rect so the popover anchors next to it; MatchesView
  // re-captures it on each open.
  anchor: DOMRect | null
}>()

const emit = defineEmits<{ close: [] }>()

const {
  sortKeys,
  addLevel,
  removeLevel,
  setLevelDir,
  setLevelColumn,
  moveLevel,
  clearSort,
} = useTableSort()

const openRef = computed(() => props.open)
useModalFocusTrap(openRef, {
  containerSelector: '.table-sort-popover',
  onClose: () => emit('close'),
})

// Click outside closes — capture-phase pointerdown ignores the popover
// body and the trigger that opened it.
const popoverRef = ref<HTMLDivElement | null>(null)
function onDocumentPointerDown(e: PointerEvent) {
  if (!openRef.value) return
  const target = e.target as HTMLElement | null
  if (!target) return
  if (popoverRef.value?.contains(target)) return
  if (target.closest('[data-sort-group-trigger]')) return
  emit('close')
}
onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
})

// Anchored under the trigger, left-aligned to its left edge; flips above
// when there isn't room below (mirrors MatchesSortGroupPopover).
const POPOVER_HEIGHT_ESTIMATE = 300
const VIEWPORT_PADDING = 8

const popoverStyle = computed(() => {
  const a = props.anchor
  if (!a) return { display: 'none' }
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 720
  const roomBelow = viewportH - (a.bottom + 6)
  const flipAbove = roomBelow < POPOVER_HEIGHT_ESTIMATE
  const top = flipAbove
    ? Math.max(VIEWPORT_PADDING, a.top - 6 - POPOVER_HEIGHT_ESTIMATE)
    : Math.max(VIEWPORT_PADDING, a.bottom + 6)
  const left = Math.max(VIEWPORT_PADDING, a.left)
  return {
    top: `${top}px`,
    left: `${left}px`,
    maxHeight: `${viewportH - top - VIEWPORT_PADDING}px`,
    overflowY: 'auto' as const,
  }
})

// Each row's column picker offers its own column plus any not already
// used by another level — a column sorts the table at most once.
function columnOptions(col: TableSortCol) {
  const used = new Set(sortKeys.value.map((l) => l.col))
  return TABLE_SORT_COLUMNS.filter((c) => c.col === col || !used.has(c.col))
}

// The first column not yet a level — what Add level appends; null once
// every column is in the stack (Add disabled).
const nextUnused = computed<TableSortCol | null>(() => {
  const used = new Set(sortKeys.value.map((l) => l.col))
  return TABLE_SORT_COLUMNS.find((c) => !used.has(c.col))?.col ?? null
})

function onAddLevel() {
  if (nextUnused.value) addLevel(nextUnused.value)
}
function onColumnChange(from: TableSortCol, e: Event) {
  setLevelColumn(from, (e.target as HTMLSelectElement).value as TableSortCol)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="openRef"
        ref="popoverRef"
        class="table-sort-popover"
        role="dialog"
        aria-modal="true"
        aria-label="Custom sort for the match table"
        data-testid="table-sort-popover"
        :style="popoverStyle"
        @click.stop
      >
        <header class="tsp-head">
          <span class="tsp-title">Custom sort</span>
          <button
            type="button"
            class="tsp-close"
            aria-label="Close custom sort"
            @click="emit('close')"
          >
            ✕
          </button>
        </header>

        <p v-if="sortKeys.length === 0" class="tsp-empty" data-sort-empty>
          No sort levels — add one below.
        </p>

        <ol class="tsp-levels">
          <li
            v-for="(level, i) in sortKeys"
            :key="level.col"
            class="tsp-level"
            data-sort-level
          >
            <span class="tsp-rank" aria-hidden="true">{{ i + 1 }}</span>

            <select
              class="tsp-select"
              data-level-col
              :value="level.col"
              :aria-label="`Sort column for level ${i + 1}`"
              @change="(e) => onColumnChange(level.col, e)"
            >
              <option v-for="opt in columnOptions(level.col)" :key="opt.col" :value="opt.col">
                {{ opt.label }}
              </option>
            </select>

            <button
              type="button"
              class="tsp-dir"
              data-level-dir
              :aria-label="`Toggle direction for level ${i + 1} (currently ${level.dir === 'asc' ? 'ascending' : 'descending'})`"
              @click="setLevelDir(level.col, level.dir === 'asc' ? 'desc' : 'asc')"
            >
              {{ level.dir === 'asc' ? 'Asc ▲' : 'Desc ▼' }}
            </button>

            <span class="tsp-move">
              <button
                type="button"
                class="tsp-icon"
                data-level-up
                :disabled="i === 0"
                aria-label="Move level up"
                @click="moveLevel(level.col, -1)"
              >
                ↑
              </button>
              <button
                type="button"
                class="tsp-icon"
                data-level-down
                :disabled="i === sortKeys.length - 1"
                aria-label="Move level down"
                @click="moveLevel(level.col, 1)"
              >
                ↓
              </button>
            </span>

            <button
              type="button"
              class="tsp-icon tsp-remove"
              data-level-remove
              :aria-label="`Remove level ${i + 1}`"
              @click="removeLevel(level.col)"
            >
              ✕
            </button>
          </li>
        </ol>

        <footer class="tsp-foot">
          <button
            type="button"
            class="tsp-add"
            data-add-level
            :disabled="!nextUnused"
            @click="onAddLevel"
          >
            ＋ Add level
          </button>
          <button
            type="button"
            class="tsp-reset"
            data-clear-sort
            @click="clearSort"
          >
            Reset
          </button>
        </footer>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.table-sort-popover {
  position: fixed;
  z-index: 60;
  min-width: 290px;
  padding: 0.55rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 3px;
  box-shadow: 0 18px 38px -16px rgb(0 0 0 / 55%);
}

.tsp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.45rem;
}

.tsp-title {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.tsp-close {
  appearance: none;
  padding: 0.1rem 0.3rem;
  font-size: 0.7rem;
  line-height: 1;
  color: var(--text-faint);
  cursor: pointer;
  background: transparent;
  border: 0;
}

.tsp-close:hover,
.tsp-close:focus-visible {
  color: var(--accent);
  outline: none;
}

.tsp-empty {
  margin: 0 0 0.45rem;
  padding: 0 0.15rem;
  font-style: italic;
  color: var(--text-faint);
}

.tsp-levels {
  margin: 0;
  padding: 0;
  list-style: none;
}

.tsp-level {
  display: flex;
  gap: 0.35rem;
  align-items: center;
  padding: 0.22rem 0;
}

.tsp-rank {
  flex: 0 0 1rem;
  font-weight: 700;
  text-align: center;
  color: var(--text-faint);
}

.tsp-select {
  flex: 1;
  min-width: 0;
  padding: 0.25rem 0.3rem;
  font-family: var(--mono);
  font-size: 0.68rem;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 2px;
}

.tsp-select:focus-visible {
  border-color: var(--accent);
  outline: none;
}

.tsp-dir {
  flex: 0 0 auto;
  padding: 0.25rem 0.4rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--accent-text, var(--accent));
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: 2px;
}

.tsp-dir:hover,
.tsp-dir:focus-visible {
  border-color: var(--accent);
  outline: none;
}

.tsp-move {
  display: inline-flex;
  gap: 0.15rem;
}

.tsp-icon {
  width: 1.3rem;
  height: 1.3rem;
  padding: 0;
  font-size: 0.7rem;
  line-height: 1;
  color: var(--text-dim);
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: 2px;
}

.tsp-icon:hover:not(:disabled),
.tsp-icon:focus-visible {
  color: var(--accent);
  border-color: var(--accent);
  outline: none;
}

.tsp-icon:disabled {
  cursor: default;
  opacity: 0.4;
}

.tsp-remove:hover:not(:disabled),
.tsp-remove:focus-visible {
  color: var(--loss);
  border-color: var(--loss);
}

.tsp-foot {
  display: flex;
  gap: 0.4rem;
  justify-content: space-between;
  margin-top: 0.5rem;
  padding-top: 0.45rem;
  border-top: 1px solid var(--border);
}

.tsp-add,
.tsp-reset {
  appearance: none;
  padding: 0.3rem 0.55rem;
  font-family: var(--mono);
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  border-radius: 2px;
}

.tsp-add {
  color: var(--primary-text-on-accent);
  background: var(--accent);
  border: 1px solid var(--accent);
}

.tsp-add:disabled {
  cursor: default;
  opacity: 0.45;
}

.tsp-reset {
  color: var(--text-dim);
  background: transparent;
  border: 1px solid var(--border-strong);
}

.tsp-reset:hover,
.tsp-reset:focus-visible,
.tsp-add:not(:disabled):hover,
.tsp-add:focus-visible {
  outline: none;
  filter: brightness(1.08);
}

.tsp-reset:hover,
.tsp-reset:focus-visible {
  color: var(--text);
  border-color: var(--text-faint);
}

@media (prefers-reduced-motion: reduce) {
  .table-sort-popover {
    transition: none;
  }
}
</style>
