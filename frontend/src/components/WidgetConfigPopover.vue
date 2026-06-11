<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useWidgetConfig } from '../composables/useWidgetConfig'
import { useModalFocusTrap } from '../composables/useModalFocusTrap'
import type { WidgetDef } from '../dashboard/widgets'

// Per-widget gear popover. Renders a form derived from the widget's
// `config.fields[]` schema, persists changes through
// useWidgetConfig (which broadcasts so the widget's own config ref
// re-hydrates without a parent-level write path). Teleports to
// <body> so the popover stacks above the rest of the dossier
// without inheriting any ancestor clip / overflow.
//
// Open / close is owned by MatchesView — the popover renders
// nothing unless `open` + a non-empty schema. Esc / click-outside
// close it. Focus trap matches the existing modal pattern.

const props = defineProps<{
  open:    boolean
  def:     WidgetDef | null
  // Bounding rect of the gear button so the popover anchors next
  // to it. Recomputed on open; the user clicking gear → popover
  // mount happens in a single tick so the rect is fresh.
  anchor:  DOMRect | null
}>()

const emit = defineEmits<{
  close: []
}>()

// Local draft of the form values. Hydrated from the live config on
// every open; Save commits via useWidgetConfig.set; Cancel discards.
// We don't mutate the live config until the user explicitly clicks
// Save so the widget keeps rendering its current value while the
// popover is open.
const draft = ref<Record<string, unknown>>({})

// Each open hydrates the draft from the current persisted value.
// We do this inside a watcher rather than in setup because the
// popover stays mounted across multiple widget selections.
const liveConfig = computed(() => {
  if (!props.def) return null
  return useWidgetConfig(props.def.id, props.def.config)
})

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen || !liveConfig.value) return
    draft.value = { ...liveConfig.value.config.value }
  },
  { immediate: true },
)

// `openRef` is the focus-trap input. Mirrors the trap pattern used
// by the unsupported-tesseract + cheatsheet modals.
const openRef = computed(() => props.open && !!props.def && props.def.config.fields.length > 0)
useModalFocusTrap(openRef, {
  containerSelector: '.widget-config-popover',
  onClose: () => emit('close'),
})

// Click outside closes. Listener captures pointerdown so the click
// on the gear button itself (which mounted the popover) doesn't
// immediately close it back.
const popoverRef = ref<HTMLDivElement | null>(null)
function onDocumentPointerDown(e: PointerEvent) {
  if (!openRef.value) return
  const t = e.target as HTMLElement | null
  if (!t) return
  if (popoverRef.value && popoverRef.value.contains(t)) return
  if (t.closest('[data-widget-config-trigger]')) return
  emit('close')
}
onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
})

// Popover position derived from the anchor rect. Anchored RIGHT-
// aligned to the gear icon, dropped below by default — same
// "attached to the affordance" feel as inline menus. Flips above
// the anchor when the anchor sits near the viewport bottom and the
// popover wouldn't fit underneath; that path matters for both
// users on short windows AND for Playwright's auto-scroll, which
// can pin the trigger near the viewport edge before clicking.
const POPOVER_WIDTH_ESTIMATE  = 240 // CSS clamps min-width 240 / max-width 320
const POPOVER_HEIGHT_ESTIMATE = 280 // typical filled-schema render; clamped at runtime via max-height
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
  const left = Math.max(VIEWPORT_PADDING, a.right - POPOVER_WIDTH_ESTIMATE)
  return {
    top:  `${top}px`,
    left: `${left}px`,
    maxHeight: `${viewportH - top - VIEWPORT_PADDING}px`,
    overflowY: 'auto' as const,
  }
})

function onIntegerChoice(key: string, value: number) {
  draft.value = { ...draft.value, [key]: value }
}
function onEnumChoice(key: string, value: string) {
  draft.value = { ...draft.value, [key]: value }
}
function onBooleanToggle(key: string, value: boolean) {
  draft.value = { ...draft.value, [key]: value }
}

function onSave() {
  if (!liveConfig.value) return
  liveConfig.value.set(draft.value)
  emit('close')
}

function onReset() {
  if (!liveConfig.value) return
  liveConfig.value.reset()
  draft.value = { ...liveConfig.value.config.value }
}

function onCancel() {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="openRef && def"
        ref="popoverRef"
        class="widget-config-popover"
        role="dialog"
        aria-modal="true"
        :aria-label="`${def.eyebrow} settings`"
        data-testid="widget-config-popover"
        :style="popoverStyle"
        @click.stop
      >
        <header class="wcp-head">
          <span class="wcp-eyebrow">{{ def.eyebrow }}</span>
          <span class="wcp-title">Settings</span>
        </header>

        <ul class="wcp-fields" role="list">
          <li
            v-for="field in def.config.fields"
            :key="field.key"
            class="wcp-field"
          >
            <label class="wcp-field-label" :for="`wcp-${def.id}-${field.key}`">
              {{ field.label }}
            </label>

            <!-- integer-choice → segmented buttons -->
            <div
              v-if="field.kind === 'integer-choice'"
              :id="`wcp-${def.id}-${field.key}`"
              class="wcp-segmented"
              role="radiogroup"
              :aria-label="field.label"
            >
              <button
                v-for="choice in field.choices"
                :key="choice"
                type="button"
                role="radio"
                class="wcp-segment"
                :class="{ 'wcp-segment-active': draft[field.key] === choice }"
                :aria-checked="draft[field.key] === choice ? 'true' : 'false'"
                :data-widget-config-choice="`${field.key}=${choice}`"
                @click="onIntegerChoice(field.key, choice)"
              >
                {{ choice }}
              </button>
            </div>

            <!-- enum → radio list -->
            <div
              v-else-if="field.kind === 'enum'"
              :id="`wcp-${def.id}-${field.key}`"
              class="wcp-radios"
              role="radiogroup"
              :aria-label="field.label"
            >
              <label
                v-for="choice in field.choices"
                :key="choice.value"
                class="wcp-radio"
              >
                <input
                  type="radio"
                  :name="`wcp-${def.id}-${field.key}`"
                  :value="choice.value"
                  :checked="draft[field.key] === choice.value"
                  :data-widget-config-choice="`${field.key}=${choice.value}`"
                  @change="onEnumChoice(field.key, choice.value)"
                >
                <span>{{ choice.label }}</span>
              </label>
            </div>

            <!-- boolean → labeled toggle -->
            <label v-else-if="field.kind === 'boolean'" class="wcp-toggle">
              <input
                :id="`wcp-${def.id}-${field.key}`"
                type="checkbox"
                :checked="!!draft[field.key]"
                :data-widget-config-choice="`${field.key}=toggle`"
                @change="onBooleanToggle(field.key, ($event.target as HTMLInputElement).checked)"
              >
              <span>{{ field.label }}</span>
            </label>
          </li>
        </ul>

        <footer class="wcp-foot">
          <button type="button" class="wcp-btn wcp-btn-ghost" data-testid="widget-config-reset" @click="onReset">
            Reset
          </button>
          <span class="wcp-foot-spacer" />
          <button type="button" class="wcp-btn wcp-btn-ghost" data-testid="widget-config-cancel" @click="onCancel">
            Cancel
          </button>
          <button type="button" class="wcp-btn wcp-btn-primary" data-testid="widget-config-save" @click="onSave">
            Save
          </button>
        </footer>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.widget-config-popover {
  position: fixed;
  z-index: 60;
  min-width: 240px;
  max-width: 320px;
  background: var(--surface-2);
  border: 1px solid var(--accent);
  border-radius: 2px;
  box-shadow: 0 12px 32px -10px rgb(0 0 0 / 45%);
  padding: 0.85rem 0.95rem 0.7rem;
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text);
}

.wcp-head {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding-bottom: 0.55rem;
  margin-bottom: 0.55rem;
  border-bottom: 1px solid var(--border);
}

.wcp-eyebrow {
  font-size: 0.6rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent-text);
  font-weight: 700;
}

.wcp-title {
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text);
}

.wcp-fields {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.wcp-field-label {
  display: block;
  font-size: 0.62rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-dim);
  margin-bottom: 0.3rem;
}

.wcp-segmented {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 2px;
  overflow: hidden;
}

.wcp-segment {
  appearance: none;
  background: transparent;
  border: none;
  padding: 0.32rem 0.7rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  color: var(--text);
  cursor: pointer;
  border-right: 1px solid var(--border);
}

.wcp-segment:last-child { border-right: none; }

.wcp-segment:hover { background: color-mix(in srgb, var(--accent) 8%, transparent); }

.wcp-segment-active {
  background: var(--accent);
  color: var(--primary-text-on-accent, #111);
  font-weight: 700;
}

.wcp-radios {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.wcp-radio {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.72rem;
  cursor: pointer;
}

.wcp-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.72rem;
  cursor: pointer;
}

.wcp-foot {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding-top: 0.7rem;
  margin-top: 0.7rem;
  border-top: 1px solid var(--border);
}

.wcp-foot-spacer { flex: 1 1 auto; }

.wcp-btn {
  appearance: none;
  border-radius: 2px;
  padding: 0.32rem 0.7rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-weight: 700;
  cursor: pointer;
  line-height: 1;
}

.wcp-btn-ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
}

.wcp-btn-ghost:hover {
  color: var(--text);
  border-color: var(--text);
}

.wcp-btn-primary {
  background: var(--accent);
  border: 1px solid var(--accent);
  color: var(--primary-text-on-accent, #111);
}

.wcp-btn-primary:hover { filter: brightness(1.08); }
</style>
