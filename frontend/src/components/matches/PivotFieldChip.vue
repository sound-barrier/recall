<script lang="ts">
import type { AggFn } from '@/match/pivot-aggregate'
import type { PivotZone } from '@/composables/matches/useMatchPivot'

// What a chip's menu item does when chosen. The parent (PivotTable) owns
// the meaning — the chip just renders the offered actions and emits the
// chosen one. Defined in a plain <script> so the type is importable.
export type ChipActPayload =
  | { type: 'assign'; zone: PivotZone }
  | { type: 'remove' }
  | { type: 'move'; delta: number }
  | { type: 'setAgg'; agg: AggFn }
  | { type: 'toggleFilter'; value: string }

export interface ChipAction {
  label: string
  payload: ChipActPayload
}

export interface FilterOption {
  value: string
  checked: boolean
}
</script>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

// A draggable field tile. Mouse users drag it between shelves; keyboard
// and screen-reader users press it to open a menu of the same moves
// (HTML5 drag-and-drop isn't keyboard-operable, so the menu is the
// accessible primary path, per .claude/rules/a11y.md). The chip is a
// <button> with the menu as a sibling — never nested interactives.
const props = defineProps<{
  fieldId: string
  label: string
  location: PivotZone | 'tray'
  index?: number
  aggLabel?: string
  actions: ChipAction[]
  filterOptions?: FilterOption[]
}>()

const emit = defineEmits<{
  dragstart: [payload: string]
  dragend: []
  act: [payload: ChipActPayload]
}>()

const wrapRef = ref<HTMLElement | null>(null)
const chipRef = ref<HTMLButtonElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const menuOpen = ref(false)

const hasMenu = () => props.actions.length > 0 || (props.filterOptions?.length ?? 0) > 0

function onDragStart(e: DragEvent) {
  const payload = JSON.stringify({ fieldId: props.fieldId, from: props.location, index: props.index })
  e.dataTransfer?.setData('text/plain', payload)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  emit('dragstart', payload)
}

function toggleMenu() {
  if (!hasMenu()) return
  menuOpen.value = !menuOpen.value
}

function choose(payload: ChipActPayload) {
  menuOpen.value = false
  chipRef.value?.focus()
  emit('act', payload)
}

// Keep filter checkboxes open while toggling several; everything else
// closes after one pick. relatedTarget leaving the wrap closes the menu.
function onFocusOut(e: FocusEvent) {
  if (!wrapRef.value?.contains(e.relatedTarget as Node | null)) menuOpen.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && menuOpen.value) {
    e.stopPropagation()
    menuOpen.value = false
    chipRef.value?.focus()
  }
}

watch(menuOpen, async (open) => {
  if (!open) return
  await nextTick()
  menuRef.value?.querySelector<HTMLElement>('button, input')?.focus()
})
</script>

<template>
  <div ref="wrapRef" class="pivot-chip-wrap" @focusout="onFocusOut" @keydown="onKeydown">
    <button
      ref="chipRef"
      type="button"
      class="pivot-chip"
      :class="`pivot-chip-${location}`"
      draggable="true"
      :aria-haspopup="hasMenu() ? 'menu' : undefined"
      :aria-expanded="hasMenu() ? (menuOpen ? 'true' : 'false') : undefined"
      :data-pivot-chip="fieldId"
      @dragstart="onDragStart"
      @dragend="emit('dragend')"
      @click="toggleMenu"
    >
      <span class="pivot-chip-grip" aria-hidden="true">⠿</span>
      <span class="pivot-chip-label">{{ label }}</span>
      <span v-if="aggLabel" class="pivot-chip-agg">{{ aggLabel }}</span>
      <span v-if="hasMenu()" class="pivot-chip-caret" aria-hidden="true">▾</span>
    </button>

    <div v-if="menuOpen" ref="menuRef" class="pivot-chip-menu" role="menu">
      <template v-if="filterOptions?.length">
        <p class="pivot-chip-menu-head">
          Show values · uncheck to hide
        </p>
        <label v-for="opt in filterOptions" :key="opt.value" class="pivot-chip-check">
          <input
            type="checkbox"
            :checked="opt.checked"
            @change="emit('act', { type: 'toggleFilter', value: opt.value })"
          >
          <span>{{ opt.value }}</span>
        </label>
        <hr v-if="actions.length" class="pivot-chip-rule">
      </template>
      <button
        v-for="(action, i) in actions"
        :key="i"
        type="button"
        role="menuitem"
        class="pivot-chip-menuitem"
        @click="choose(action.payload)"
      >
        {{ action.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.pivot-chip-wrap {
  position: relative;
}

.pivot-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.32rem;
  padding: 0.22rem 0.4rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 3px;
  cursor: grab;
  transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
}

.pivot-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.pivot-chip:active {
  cursor: grabbing;
}

.pivot-chip:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

/* Placed chips read in the burnt-amber identity tone of the data they
   carry; tray chips stay neutral until used. */
.pivot-chip-rows,
.pivot-chip-columns,
.pivot-chip-filters {
  color: var(--identity-accent);
  border-color: color-mix(in srgb, var(--identity-accent) 45%, var(--border));
}

.pivot-chip-values {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}

.pivot-chip-grip {
  font-size: 0.6rem;
  color: var(--text-dim);
  line-height: 1;
}

.pivot-chip-label {
  text-transform: uppercase;
  font-weight: 700;
}

.pivot-chip-agg {
  padding: 0.04rem 0.28rem;
  font-size: 0.52rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--primary-text-on-accent);
  background: var(--accent);
  border-radius: 2px;
}

.pivot-chip-caret {
  font-size: 0.5rem;
  color: var(--text-faint);
}

.pivot-chip-menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 0.2rem);
  left: 0;
  min-width: 9rem;
  display: flex;
  flex-direction: column;
  padding: 0.25rem;
  background: var(--surface-3, var(--surface));
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 35%);
}

.pivot-chip-menu-head {
  margin: 0.1rem 0.3rem 0.2rem;
  font-family: var(--mono);
  font-size: 0.5rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.pivot-chip-menuitem {
  text-align: left;
  padding: 0.3rem 0.4rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--text);
  background: transparent;
  border: none;
  border-radius: 3px;
  cursor: pointer;
}

.pivot-chip-menuitem:hover,
.pivot-chip-menuitem:focus-visible {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  outline: none;
}

.pivot-chip-check {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.22rem 0.4rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--text);
  cursor: pointer;
}

.pivot-chip-check input {
  accent-color: var(--accent);
}

.pivot-chip-rule {
  margin: 0.25rem 0.3rem;
  border: none;
  border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .pivot-chip { transition: none; }
}
</style>
