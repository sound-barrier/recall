<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'

import { useDashboardLayout } from '../composables/useDashboardLayout'
import { useSectionLayout, type SectionDef } from '../composables/useSectionLayout'
import { WIDGET_REGISTRY, type WidgetDef, type WidgetShape } from '../dashboard/widgets'

// Compact "Add / Reset" dropdown for the dossier. Lists everything the
// user has removed — widgets (grouped by shape) and full-width
// sections (Campaign Log, Geography) — each with a + to re-add, plus a
// Reset that restores both the widget layout and the sections to the
// install default. Stays open after an add so the user can pile a few
// on; closes on a pick of Reset, Escape, or an outside click.
//
// Replaces the old full-screen "Add to dashboard" modal: with the edit
// MODE gone, re-adding is the only thing that needs a surface (remove
// + reorder live inline on the widgets/sections themselves), so a
// light dropdown beats a modal.

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const layout = useDashboardLayout()
const sections = useSectionLayout()

interface WidgetCategory {
  title: string
  shape: WidgetShape
  rows: readonly WidgetDef[]
}

const addableWidgets = computed<readonly WidgetDef[]>(() => {
  const inLayout = new Set(Object.values(layout.rows.value).flat())
  return WIDGET_REGISTRY.filter((def) => !inLayout.has(def.id))
})

const widgetCategories = computed<readonly WidgetCategory[]>(() => {
  const byShape: Record<WidgetShape, WidgetDef[]> = { kpi: [], breakdown: [] }
  for (const def of addableWidgets.value) byShape[def.shape].push(def)
  return [
    { title: 'KPIs', shape: 'kpi', rows: byShape.kpi },
    { title: 'Breakdowns', shape: 'breakdown', rows: byShape.breakdown },
  ]
})

const nothingToAdd = computed(
  () => addableWidgets.value.length === 0 && sections.addable.value.length === 0,
)

function addWidget(def: WidgetDef) {
  layout.appendToRow(def.defaultRow, def.id)
}

function addSection(sec: SectionDef) {
  sections.add(sec.id)
}

function onReset() {
  layout.reset()
  sections.reset()
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) document.addEventListener('keydown', onKeydown, true)
    else document.removeEventListener('keydown', onKeydown, true)
  },
)
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Transition name="dossier-manage-fade">
    <div v-if="open" class="dossier-manage" role="dialog" aria-label="Add to dossier">
      <!-- Invisible click-catcher closes the menu on an outside click. -->
      <div class="dossier-manage-scrim" @click="emit('close')" />

      <div class="dossier-manage-panel">
        <p v-if="nothingToAdd" class="dossier-manage-empty">
          Everything&rsquo;s already on your dossier.
        </p>

        <template v-else>
          <section
            v-for="cat in widgetCategories"
            v-show="cat.rows.length > 0"
            :key="cat.shape"
            class="dossier-manage-group"
          >
            <span class="dossier-manage-group-title">{{ cat.title }}</span>
            <button
              v-for="def in cat.rows"
              :key="def.id"
              type="button"
              class="dossier-manage-item"
              :data-widget-add="def.id"
              @click="addWidget(def)"
            >
              <span class="dossier-manage-item-name">{{ def.eyebrow }}</span>
              <span class="dossier-manage-item-add" aria-hidden="true">+</span>
            </button>
          </section>

          <section v-if="sections.addable.value.length > 0" class="dossier-manage-group">
            <span class="dossier-manage-group-title">Sections</span>
            <button
              v-for="sec in sections.addable.value"
              :key="sec.id"
              type="button"
              class="dossier-manage-item"
              :data-section-add="sec.id"
              @click="addSection(sec)"
            >
              <span class="dossier-manage-item-name">{{ sec.label }}</span>
              <span class="dossier-manage-item-add" aria-hidden="true">+</span>
            </button>
          </section>
        </template>

        <footer class="dossier-manage-foot">
          <button
            type="button"
            class="dossier-manage-reset"
            data-reset-layout
            @click="onReset"
          >
            Reset dossier
          </button>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.dossier-manage {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 60;
}

/* Full-viewport click-catcher behind the panel. */
.dossier-manage-scrim {
  position: fixed;
  inset: 0;
  z-index: -1;
}

.dossier-manage-panel {
  width: min(280px, 86vw);
  max-height: min(60vh, 460px);
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: 2px;
  box-shadow: 0 22px 48px -20px rgb(0 0 0 / 55%);
  padding: 0.5rem 0.45rem 0.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}

.dossier-manage-empty {
  margin: 0.3rem 0.4rem;
  font-size: 0.78rem;
  color: var(--text-faint);
  font-style: italic;
}

.dossier-manage-group {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}

.dossier-manage-group-title {
  font-family: var(--mono);
  font-size: 0.56rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
  padding: 0.15rem 0.4rem 0.25rem;
}

.dossier-manage-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  width: 100%;
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 2px;
  padding: 0.34rem 0.45rem;
  cursor: pointer;
  color: var(--text);
  text-align: left;
  transition: background 130ms ease, border-color 130ms ease;
}

.dossier-manage-item:hover {
  background: var(--surface-2);
  border-color: var(--border);
}

.dossier-manage-item-name {
  font-family: var(--display);
  font-style: italic;
  font-size: 0.92rem;
  letter-spacing: 0.02em;
}

.dossier-manage-item-add {
  font-family: var(--mono);
  font-size: 1rem;
  color: var(--accent);
  line-height: 1;
}

.dossier-manage-item:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.dossier-manage-foot {
  border-top: 1px solid var(--border);
  padding-top: 0.4rem;
  margin-top: 0.1rem;
}

.dossier-manage-reset {
  appearance: none;
  width: 100%;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 0.66rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 0.4rem 0.5rem;
  border-radius: 2px;
  cursor: pointer;
  transition: color 130ms ease, border-color 130ms ease, background 130ms ease;
}

.dossier-manage-reset:hover {
  color: var(--loss);
  border-color: var(--loss-line, var(--loss));
}

.dossier-manage-reset:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.dossier-manage-fade-enter-active,
.dossier-manage-fade-leave-active {
  transition: opacity 150ms ease, transform 150ms ease;
}

.dossier-manage-fade-enter-active .dossier-manage-panel,
.dossier-manage-fade-leave-active .dossier-manage-panel {
  transition: transform 160ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

.dossier-manage-fade-enter-from,
.dossier-manage-fade-leave-to {
  opacity: 0;
}

.dossier-manage-fade-enter-from .dossier-manage-panel,
.dossier-manage-fade-leave-to .dossier-manage-panel {
  transform: translateY(-6px);
}

@media (prefers-reduced-motion: reduce) {
  .dossier-manage-fade-enter-active,
  .dossier-manage-fade-leave-active,
  .dossier-manage-fade-enter-active .dossier-manage-panel,
  .dossier-manage-fade-leave-active .dossier-manage-panel {
    transition: none;
  }
}
</style>
