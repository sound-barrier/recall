<script lang="ts">
import type { AggFn } from '@/match/pivot/pivot-aggregate'
import type { PivotZone } from '@/composables/matches/pivot/useMatchPivot'

// What a chip's menu item does when chosen. The parent (PivotTable) owns
// the meaning — the chip just renders the offered actions and emits the
// chosen one. Defined in a plain <script> so the type is importable.
export type ChipActPayload =
  | { type: 'assign'; zone: PivotZone }
  | { type: 'remove' }
  | { type: 'move'; delta: number }
  | { type: 'setAgg'; agg: AggFn }
  | { type: 'toggleFilter'; value: string }
  | { type: 'filterReset' }

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
// eslint-disable-next-line no-restricted-syntax -- vue-eslint-parser merges this SFC's two <script> blocks into ONE Program, so this block's first import reads as following the other block's statements; the split exists because a type cannot be exported from <script setup> (frontend/CLAUDE.md).
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

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
const shownCount = computed(() => props.filterOptions?.filter((o) => o.checked).length ?? 0)

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

// Dismiss on an outside pointer press rather than focusout: WebKit (the
// desktop WKWebView) doesn't focus a <button> on click, so a focusout-based
// close fired mid-click and swallowed the toggle — the box "wouldn't
// uncheck." An outside-pointerdown listener is engine-agnostic and keeps
// the menu open while the user flips several filter values inside it.
function onDocPointerDown(e: Event) {
  if (!wrapRef.value?.contains(e.target as Node | null)) menuOpen.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && menuOpen.value) {
    e.stopPropagation()
    menuOpen.value = false
    chipRef.value?.focus()
  }
}

watch(menuOpen, async (open) => {
  if (open) {
    document.addEventListener('pointerdown', onDocPointerDown, true)
    await nextTick()
    menuRef.value?.querySelector<HTMLElement>('button, input')?.focus()
  } else {
    document.removeEventListener('pointerdown', onDocPointerDown, true)
  }
})

onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointerDown, true))
</script>

<template>
  <div ref="wrapRef" class="pivot-chip-wrap" @keydown="onKeydown">
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
        <div class="pivot-chip-menu-head">
          <span>{{ shownCount }} of {{ filterOptions.length }} shown</span>
          <button type="button" class="pivot-chip-reset" @click="emit('act', { type: 'filterReset' })">
            All
          </button>
        </div>
        <!-- Rendered as menuitemcheckbox buttons rather than native
             <input> so the tick is driven entirely by our model
             (opt.checked) — a native checkbox toggles its own DOM state on
             click, which desynced from Vue's one-way :checked bind and left
             the box visually stuck. Clicking toggles inclusion without
             closing the menu, so several values can be flipped in a row. -->
        <button
          v-for="opt in filterOptions"
          :key="opt.value"
          type="button"
          role="menuitemcheckbox"
          :aria-checked="opt.checked"
          class="pivot-chip-check"
          @click="emit('act', { type: 'toggleFilter', value: opt.value })"
        >
          <span class="pivot-chip-box" aria-hidden="true">{{ opt.checked ? '✓' : '' }}</span>
          <span class="pivot-chip-cklabel">{{ opt.value }}</span>
        </button>
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
  font-size: var(--type-2xs);
  letter-spacing: 0.06em;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: grab;
  transition: border-color var(--duration-instant) ease, background var(--duration-instant) ease, color var(--duration-instant) ease;
}

.pivot-chip:hover {
  border-color: var(--accent);
  color: var(--accent-text);
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
  color: var(--accent-text);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}

.pivot-chip-grip {
  font-size: var(--type-2xs);
  color: var(--text-dim);
  line-height: 1;
}

.pivot-chip-label {
  text-transform: uppercase;
  font-weight: 700;
}

.pivot-chip-agg {
  padding: 0.04rem 0.28rem;
  font-size: var(--type-4xs);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--primary-text-on-accent);
  background: var(--accent);
  border-radius: var(--radius);
}

.pivot-chip-caret {
  font-size: var(--type-4xs);
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
  padding: var(--space-1);
  background: var(--surface-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 24px rgb(var(--shadow-rgb) / 35%);
}

.pivot-chip-menu-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin: 0.1rem 0.3rem 0.3rem;
  font-family: var(--mono);
  font-size: var(--type-4xs);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.pivot-chip-reset {
  font-family: var(--mono);
  font-size: var(--type-4xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 0.1rem 0.35rem;
  color: var(--accent-text);
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--accent) 50%, var(--border));
  border-radius: var(--radius);
  cursor: pointer;
}

.pivot-chip-reset:hover {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.pivot-chip-menuitem {
  text-align: left;
  padding: 0.3rem 0.4rem;
  font-family: var(--mono);
  font-size: var(--type-2xs);
  color: var(--text);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
}

.pivot-chip-menuitem:hover,
.pivot-chip-menuitem:focus-visible {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent-text);
  outline: none;
}

/* :where() keeps specificity at 0 so the UA button reset doesn't beat the
   shared menu styles (the promote-span-to-button gotcha). */
:where(button.pivot-chip-check) {
  appearance: none;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
}

.pivot-chip-check {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.22rem 0.4rem;
  font-family: var(--mono);
  font-size: var(--type-2xs);
  color: var(--text);
  cursor: pointer;
}

.pivot-chip-check:hover,
.pivot-chip-check:focus-visible {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  outline: none;
}

/* A real checkbox face: filled accent square + ✓ when included, an empty
   outlined box when excluded. The label strikes through + dims on exclude,
   so the state reads at a glance even across a long value list. */
.pivot-chip-box {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 0.95rem;
  height: 0.95rem;
  border: 1.5px solid var(--border-strong);
  border-radius: var(--radius-md);
  font-size: var(--type-sm);
  line-height: 1;
  color: var(--primary-text-on-accent);
}

.pivot-chip-check[aria-checked="true"] .pivot-chip-box {
  background: var(--accent);
  border-color: var(--accent);
}

.pivot-chip-check[aria-checked="false"] .pivot-chip-cklabel {
  color: var(--text-dim);
  text-decoration: line-through;
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
