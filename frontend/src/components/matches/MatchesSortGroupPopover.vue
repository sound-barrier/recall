<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useModalFocusTrap } from '@/composables/shared/useModalFocusTrap'

// Combined Sort + Group dropdown for the Matches leaves head. Two
// radio groups inside one anchored popover — saves horizontal real
// estate that the prior two-fieldset row consumed and consolidates
// "how am I cutting this list?" into a single trigger.
//
// Density stays its own fieldset in MatchesView — it's ergonomically
// a toggle, not a multi-axis pick. Mirroring it into this popover
// would muddle the UX.
//
// Open / close + position is owned by MatchesView; the popover
// emits `close` for Esc / click-outside / radio-pick. Selection
// changes fire `update:sort` / `update:group` immediately so the
// leaves list re-renders before the popover dismisses — same feel
// as inline radio segmented buttons.

type SortOrder = 'newest' | 'oldest'
type GroupBy   = 'none' | 'day' | 'week' | 'month' | 'year'

const props = defineProps<{
  open:    boolean
  sort:    SortOrder
  group:   GroupBy
  // Bounding rect of the trigger button so the popover anchors next
  // to it. MatchesView re-captures the rect on each open so resizes
  // and scroll between opens produce a fresh anchor.
  anchor:  DOMRect | null
  // Data density is a flat spreadsheet sorted by column header, so
  // grouping doesn't apply there — the Group fieldset greys out.
  groupingDisabled?: boolean
}>()

const emit = defineEmits<{
  close:        []
  'update:sort':  [next: SortOrder]
  'update:group': [next: GroupBy]
}>()

const openRef = computed(() => props.open)
useModalFocusTrap(openRef, {
  containerSelector: '.sort-group-popover',
  onClose: () => emit('close'),
})

// Click outside closes — capture-phase pointerdown ignores clicks
// on the popover body itself + the trigger that opened it.
const popoverRef = ref<HTMLDivElement | null>(null)
function onDocumentPointerDown(e: PointerEvent) {
  if (!openRef.value) return
  const t = e.target as HTMLElement | null
  if (!t) return
  if (popoverRef.value && popoverRef.value.contains(t)) return
  if (t.closest('[data-sort-group-trigger]')) return
  emit('close')
}
onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
})

// Position helper — anchored under the trigger, left-aligned to its
// left edge. Flips above when there isn't enough room below (e.g.
// short window or Playwright auto-scroll pinning the trigger near
// the viewport bottom).
const POPOVER_HEIGHT_ESTIMATE = 240
const VIEWPORT_PADDING        = 8

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
    top:  `${top}px`,
    left: `${left}px`,
    maxHeight: `${viewportH - top - VIEWPORT_PADDING}px`,
    overflowY: 'auto' as const,
  }
})

const SORT_OPTIONS: { value: SortOrder; label: string; glyph: string }[] = [
  { value: 'newest', label: 'Newest first', glyph: '↓' },
  { value: 'oldest', label: 'Oldest first', glyph: '↑' },
]

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'none',  label: 'No grouping' },
  { value: 'day',   label: 'By day' },
  { value: 'week',  label: 'By week' },
  { value: 'month', label: 'By month' },
  { value: 'year',  label: 'By year' },
]
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="openRef"
        ref="popoverRef"
        class="sort-group-popover"
        role="dialog"
        aria-modal="true"
        aria-label="Sort and group the matches list"
        data-testid="sort-group-popover"
        :style="popoverStyle"
        @click.stop
      >
        <fieldset class="sgp-group">
          <legend class="sgp-legend">
            Sort
          </legend>
          <label
            v-for="opt in SORT_OPTIONS"
            :key="opt.value"
            class="sgp-row"
            :class="{ picked: sort === opt.value }"
          >
            <input
              type="radio"
              name="sort"
              :value="opt.value"
              :checked="sort === opt.value"
              :data-sort-pick="opt.value"
              @change="emit('update:sort', opt.value)"
            >
            <span class="sgp-label">{{ opt.label }}</span>
            <span class="sgp-glyph" aria-hidden="true">{{ opt.glyph }}</span>
          </label>
        </fieldset>

        <fieldset class="sgp-group" :class="{ 'sgp-group-disabled': groupingDisabled }" :disabled="groupingDisabled">
          <legend class="sgp-legend">
            Group
          </legend>
          <p v-if="groupingDisabled" class="sgp-hint" data-grouping-disabled-hint>
            Data view sorts by column header
          </p>
          <label
            v-for="opt in GROUP_OPTIONS"
            :key="opt.value"
            class="sgp-row"
            :class="{ picked: group === opt.value }"
          >
            <input
              type="radio"
              name="group"
              :value="opt.value"
              :checked="group === opt.value"
              :data-group-pick="opt.value"
              @change="emit('update:group', opt.value)"
            >
            <span class="sgp-label">{{ opt.label }}</span>
          </label>
        </fieldset>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sort-group-popover {
  position: fixed;
  z-index: 60;
  min-width: 220px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 3px;
  box-shadow: 0 18px 38px -16px rgb(0 0 0 / 55%);
  padding: 0.55rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  color: var(--text);
}

.sgp-group {
  appearance: none;
  border: 0;
  padding: 0;
  margin: 0 0 0.4rem;
}
.sgp-group:last-child { margin-bottom: 0; }

.sgp-group-disabled { opacity: 0.42; }
.sgp-group-disabled .sgp-row { cursor: default; }
.sgp-group-disabled .sgp-row:hover { background: transparent; }

.sgp-hint {
  margin: 0 0 0.3rem;
  padding: 0 0.15rem;
  font-size: 0.58rem;
  letter-spacing: 0.06em;
  color: var(--text-faint);
  font-style: italic;
}

.sgp-legend {
  font-size: 0.6rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
  font-weight: 700;
  padding: 0 0.15rem 0.25rem;
}

.sgp-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.32rem 0.45rem;
  border-radius: 2px;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}

.sgp-row input[type="radio"] {
  width: 12px;
  height: 12px;
  margin: 0;
  accent-color: var(--accent);
}

.sgp-row:hover {
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}

.sgp-row.picked {
  color: var(--accent-text, var(--accent));
}

.sgp-row.picked .sgp-label {
  font-weight: 700;
}

.sgp-label {
  flex: 1;
  text-transform: capitalize;
}

.sgp-glyph {
  font-size: 0.85rem;
  color: var(--text-faint);
}

.sgp-row.picked .sgp-glyph { color: var(--accent); }

@media (prefers-reduced-motion: reduce) {
  .sort-group-popover { transition: none; }
}
</style>
