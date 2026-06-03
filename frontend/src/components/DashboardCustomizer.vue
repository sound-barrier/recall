<script setup lang="ts">
import { computed, toRef } from 'vue'

import { useModalFocusTrap } from '../composables/useModalFocusTrap'
import { useDashboardLayout } from '../composables/useDashboardLayout'
import { WIDGET_REGISTRY, type WidgetDef, type WidgetShape } from '../dashboard/widgets'

// "Add to dashboard" modal — surfaces every registered widget that
// is NOT currently in the user's layout, grouped by shape, with a
// "+ Add" button per row. Layout membership is the single source of
// truth: trash on the widget removes it from the layout; add here
// puts it back.
//
// The modal stays open after each add so the user can pile on
// multiple widgets in one session. "Reset layout" wipes to the
// install default.

const props = defineProps<{
  open: boolean
}>()
const emit = defineEmits<{ close: [] }>()

const layout = useDashboardLayout()

const openRef = toRef(props, 'open')
useModalFocusTrap(openRef, {
  containerSelector: '.dashboard-customizer-box',
  onClose: () => emit('close'),
})

interface CategorySection {
  title: string
  helper: string
  shape: WidgetShape
  rows: ReadonlyArray<WidgetDef>
}

// Widgets the user does NOT currently have on the dashboard. Layout
// membership is the canonical "is this rendered" predicate, so an
// addable widget is one whose id doesn't appear in any row.
const addable = computed<readonly WidgetDef[]>(() => {
  const inLayout = new Set(Object.values(layout.rows.value).flat())
  return WIDGET_REGISTRY.filter((def) => !inLayout.has(def.id))
})

const categories = computed<readonly CategorySection[]>(() => {
  const byShape: Record<WidgetShape, WidgetDef[]> = { kpi: [], breakdown: [] }
  for (const def of addable.value) byShape[def.shape].push(def)
  return [
    {
      title: 'KPIs',
      helper: 'Compact tiles for the dossier\'s headline row.',
      shape: 'kpi',
      rows: byShape.kpi,
    },
    {
      title: 'Breakdowns',
      helper: 'Bar-graph rows with per-entry shares.',
      shape: 'breakdown',
      rows: byShape.breakdown,
    },
  ]
})

function onAdd(def: WidgetDef) {
  layout.appendToRow(def.defaultRow, def.id)
}

function onReset() {
  layout.reset()
}

function onBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dashboard-customizer-fade">
      <div
        v-if="open"
        class="dashboard-customizer-backdrop"
        role="presentation"
        @click="onBackdropClick"
      >
        <div
          class="dashboard-customizer-box"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dashboard-customizer-title"
        >
          <header class="dashboard-customizer-head">
            <h2 id="dashboard-customizer-title" class="dashboard-customizer-title">
              Add to dashboard
            </h2>
            <p class="dashboard-customizer-sub">
              Browse widgets you don&rsquo;t have on your dashboard. Click + to add one
              to its default row.
            </p>
          </header>

          <div class="dashboard-customizer-body">
            <section
              v-for="cat in categories"
              :key="cat.shape"
              class="dashboard-customizer-section"
              :aria-labelledby="`dashboard-cat-${cat.shape}`"
            >
              <header class="dashboard-customizer-section-head">
                <span :id="`dashboard-cat-${cat.shape}`" class="dashboard-customizer-section-title">
                  {{ cat.title }}
                </span>
                <span class="dashboard-customizer-section-helper">{{ cat.helper }}</span>
              </header>
              <p v-if="cat.rows.length === 0" class="dashboard-customizer-empty">
                All {{ cat.title.toLowerCase() }} are on your dashboard.
              </p>
              <ul v-else class="dashboard-customizer-list">
                <li v-for="def in cat.rows" :key="def.id" class="dashboard-customizer-row">
                  <span class="dashboard-customizer-row-name">{{ def.eyebrow }}</span>
                  <button
                    type="button"
                    class="dashboard-customizer-add"
                    :data-widget-add="def.id"
                    @click="onAdd(def)"
                  >
                    + Add
                  </button>
                </li>
              </ul>
            </section>
          </div>

          <footer class="dashboard-customizer-foot">
            <button
              type="button"
              class="dashboard-customizer-btn dashboard-customizer-btn-ghost"
              data-reset-layout
              @click="onReset"
            >
              Reset layout
            </button>
            <button
              type="button"
              class="dashboard-customizer-btn dashboard-customizer-btn-primary"
              @click="emit('close')"
            >
              Done
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Backdrop — translucent dim with a faint blur. Mirrors the
   narrow-popover backdrop in feel but lives in its own scope.
   z-index 80 sits above MatchesView's narrow popover (z 75) and
   below MatchScreenshotLightbox (z 95). */
.dashboard-customizer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: color-mix(in srgb, var(--bg) 55%, transparent);
  backdrop-filter: blur(2px);
}

.dashboard-customizer-box {
  width: min(540px, 100%);
  max-height: calc(100vh - 3rem);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: 2px;
  box-shadow: 0 28px 60px -24px rgb(0 0 0 / 55%);
  overflow: hidden;
}

.dashboard-customizer-head {
  padding: 0.9rem 1.1rem 0.7rem;
  border-bottom: 1px solid var(--border);
  background:
    repeating-linear-gradient(135deg, var(--surface-3) 0 14px, var(--surface-2) 14px 28px);
}

.dashboard-customizer-title {
  margin: 0;
  font-family: var(--display);
  font-style: italic;
  font-size: 1.4rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text);
}

.dashboard-customizer-sub {
  margin: 0.35rem 0 0;
  font-size: 0.78rem;
  color: var(--text-dim);
  line-height: 1.4;
}

.dashboard-customizer-body {
  flex: 1;
  overflow-y: auto;
  padding: 0.9rem 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 1.05rem;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}

.dashboard-customizer-section {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.dashboard-customizer-section-head {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.dashboard-customizer-section-title {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
}

.dashboard-customizer-section-helper {
  font-size: 0.72rem;
  color: var(--text-faint);
}

.dashboard-customizer-empty {
  margin: 0.1rem 0 0;
  font-size: 0.78rem;
  color: var(--text-faint);
  font-style: italic;
}

.dashboard-customizer-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.dashboard-customizer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.32rem 0.45rem;
  border: 1px solid transparent;
  border-radius: 2px;
  font-size: 0.85rem;
  color: var(--text);
  transition: background 140ms ease, border-color 140ms ease;
}

.dashboard-customizer-row:hover {
  background: var(--surface-2);
  border-color: var(--border);
}

.dashboard-customizer-row-name {
  font-family: var(--display);
  font-style: italic;
  letter-spacing: 0.02em;
}

.dashboard-customizer-add {
  appearance: none;
  border: 1px solid var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 0.3rem 0.65rem;
  border-radius: 2px;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}

.dashboard-customizer-add:hover {
  background: color-mix(in srgb, var(--accent-soft) 60%, var(--accent));
  color: var(--text);
}

.dashboard-customizer-add:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.dashboard-customizer-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.75rem 1.1rem;
  border-top: 1px solid var(--border);
  background: var(--surface-2);
}

.dashboard-customizer-btn {
  appearance: none;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  font-family: var(--mono);
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 0.42rem 0.85rem;
  border-radius: 2px;
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
}

.dashboard-customizer-btn-ghost {
  color: var(--text-dim);
}

.dashboard-customizer-btn-ghost:hover {
  color: var(--loss);
  border-color: var(--loss-line);
}

.dashboard-customizer-btn-primary {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

.dashboard-customizer-btn-primary:hover {
  background: color-mix(in srgb, var(--accent-soft) 60%, var(--accent));
  color: var(--text);
}

.dashboard-customizer-btn:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.dashboard-customizer-fade-enter-active,
.dashboard-customizer-fade-leave-active {
  transition: opacity 180ms ease, backdrop-filter 180ms ease;
}

.dashboard-customizer-fade-enter-active .dashboard-customizer-box,
.dashboard-customizer-fade-leave-active .dashboard-customizer-box {
  transition: transform 220ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity 180ms ease;
}

.dashboard-customizer-fade-enter-from,
.dashboard-customizer-fade-leave-to {
  opacity: 0;
  backdrop-filter: none;
}

.dashboard-customizer-fade-enter-from .dashboard-customizer-box,
.dashboard-customizer-fade-leave-to .dashboard-customizer-box {
  transform: translateY(8px);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .dashboard-customizer-fade-enter-active,
  .dashboard-customizer-fade-leave-active,
  .dashboard-customizer-fade-enter-active .dashboard-customizer-box,
  .dashboard-customizer-fade-leave-active .dashboard-customizer-box {
    transition: none;
  }
}
</style>
