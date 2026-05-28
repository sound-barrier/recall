<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import type { FilterPreset } from '../composables/useFilterPresets'

// "Saved Loadouts" dropdown — surfaces in the FilterRail's tools row.
// Holds the user's named filter combos so a single click restores the
// whole eight-field multi-select + date range + threshold knobs in one
// motion. The composable owns persistence; this component is the
// chrome around save/apply/delete and the prompt that names a new one.
//
// Closing rules mirror the multi-select popovers: outside-click and
// ESC close. The trigger stays focused after close so the keyboard
// chain is preserved.

const props = defineProps<{
  presets: FilterPreset[]
  // True when at least one filter is engaged. Disables Save Current
  // when false — saving an empty preset would just be a "Clear Filters"
  // button with extra steps.
  anyFilter: boolean
}>()

const emit = defineEmits<{
  // App.vue captures the current filter state, then calls savePreset
  // on the composable. The component asks for a name first; the
  // emit fires only after the user confirms.
  'save-current': [name: string]
  'apply':        [name: string]
  'delete':       [name: string]
}>()

const open = ref(false)
const triggerRef = ref<HTMLButtonElement | null>(null)
const panelRef = ref<HTMLDivElement | null>(null)

function toggle() {
  open.value = !open.value
}

function close() {
  open.value = false
}

function onDocMousedown(e: MouseEvent) {
  if (!open.value) return
  const t = e.target as Node | null
  if (panelRef.value?.contains(t)) return
  if (triggerRef.value?.contains(t)) return
  close()
}

function onDocKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) {
    close()
    // Return focus to the trigger so the keyboard chain stays.
    triggerRef.value?.focus()
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocMousedown)
  document.addEventListener('keydown', onDocKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMousedown)
  document.removeEventListener('keydown', onDocKeydown)
})

function promptForName(): string | null {
  // The composable handles trim + empty-rejection, but doing the trim
  // here too means the "already exists" check (below) sees the same
  // canonical form the user will see in the menu.
  const raw = window.prompt('Name this preset:', defaultPresetName.value)
  if (raw === null) return null
  const name = raw.trim()
  if (!name) return null
  return name
}

function onSave() {
  const name = promptForName()
  if (!name) return
  // Warn before clobbering — the composable will replace silently
  // otherwise. confirm() returning false leaves the existing preset
  // intact, matching how most "overwrite?" UIs behave.
  const existing = props.presets.some(p => p.name === name)
  if (existing && !window.confirm(`Preset "${name}" already exists. Overwrite it?`)) return
  emit('save-current', name)
  // Keep the menu open so the user sees the new entry land in the
  // list — confirms the save succeeded without needing a separate
  // toast.
}

function onApply(name: string) {
  emit('apply', name)
  close()
}

function onDelete(name: string) {
  if (!window.confirm(`Delete preset "${name}"? This cannot be undone.`)) return
  emit('delete', name)
}

// Most-recent-first ordering — the preset the user just saved sits
// at the top, ready for a re-apply. Falls back to alphabetic when
// savedAt is missing (older shapes).
const sortedPresets = computed(() => {
  return [...props.presets].sort((a, b) => {
    const ta = a.savedAt ?? 0
    const tb = b.savedAt ?? 0
    if (ta !== tb) return tb - ta
    return a.name.localeCompare(b.name)
  })
})

// One-line summary of what filters a preset narrows by. Keeps the
// menu informative without forcing the user to apply a preset to
// remember what it did. Returns "—" if the preset is somehow empty
// (defensive — `anyFilter` prevents the save path from getting here,
// but a hand-edited localStorage could).
function summary(p: FilterPreset): string {
  const s = p.snapshot
  const parts: string[] = []
  const f = s.filters
  const counts: Array<[string, number]> = [
    ['Mode',   f.mode.length],
    ['Map',    f.map.length],
    ['Type',   f.type.length],
    ['Role',   f.role.length],
    ['Hero',   f.hero.length],
    ['Result', f.result.length],
    ['Source', f.sshot.length],
    ['Tag',    f.tags.length],
  ]
  for (const [label, n] of counts) {
    if (n > 0) parts.push(`${label} ${n}`)
  }
  if (s.noteSearch.trim()) parts.push(`Note "${s.noteSearch.trim()}"`)
  if (s.filterFrom || s.filterTo) parts.push('Date range')
  if (s.minPlayPercent > 0) parts.push(`≥${s.minPlayPercent}% played`)
  if (s.minPlayMinutes > 0) {
    const m = Math.floor(s.minPlayMinutes)
    const sec = Math.round((s.minPlayMinutes - m) * 60)
    parts.push(`≥${m}m${sec ? ` ${sec}s` : ''} played`)
  }
  if (s.includeUndated) parts.push('Includes undated')
  if (s.showHidden) parts.push('Shows hidden')
  if (s.leaverHandling !== 'include') parts.push(`Leavers: ${s.leaverHandling}`)
  return parts.length ? parts.join(' · ') : '—'
}

// Suggest "Preset N" as a default — saves the user three keystrokes
// when they just want a numbered slot.
const defaultPresetName = computed(() => {
  let i = props.presets.length + 1
  while (props.presets.some(p => p.name === `Preset ${i}`)) i++
  return `Preset ${i}`
})
</script>

<template>
  <div class="presets-wrap" :class="{ open }">
    <button
      ref="triggerRef"
      type="button"
      class="presets-trigger"
      :class="{ active: open, populated: presets.length > 0 }"
      :aria-expanded="open"
      :aria-haspopup="true"
      :aria-label="`Filter presets, ${presets.length} saved`"
      :title="presets.length === 0
        ? 'Save your current filter combination for one-click recall later.'
        : `Recall one of your ${presets.length} saved filter preset${presets.length === 1 ? '' : 's'}.`"
      @click="toggle"
    >
      <span class="presets-glyph" aria-hidden="true">⌘</span>
      <span class="presets-label">Presets</span>
      <span v-if="presets.length > 0" class="presets-badge">{{ presets.length }}</span>
      <span class="presets-caret" aria-hidden="true" />
    </button>

    <div
      v-if="open"
      ref="panelRef"
      class="presets-panel"
      role="menu"
      aria-label="Filter presets menu"
    >
      <div class="presets-head">
        <span class="presets-head-title">SAVED LOADOUTS</span>
        <span class="presets-head-meta">{{ presets.length }} on file</span>
      </div>

      <div class="presets-save-row">
        <button
          type="button"
          class="presets-save-btn"
          :class="{ ready: anyFilter }"
          :disabled="!anyFilter"
          :title="anyFilter
            ? 'Save the current filter combination as a recallable preset.'
            : 'Engage at least one filter, then save the combination for later.'"
          data-preset-action="save"
          @click="onSave"
        >
          <span class="presets-save-mark" aria-hidden="true">+</span>
          <span class="presets-save-label">Save current</span>
          <span class="presets-save-hint">
            {{ anyFilter ? 'name it & recall later' : 'pick a filter first' }}
          </span>
        </button>
      </div>

      <ul v-if="sortedPresets.length" class="presets-list">
        <li
          v-for="p in sortedPresets"
          :key="p.name"
          class="presets-row"
        >
          <button
            type="button"
            class="presets-row-apply"
            :data-preset-apply="p.name"
            :title="`Apply preset: ${summary(p)}`"
            @click="onApply(p.name)"
          >
            <span class="presets-row-name">{{ p.name }}</span>
            <span class="presets-row-summary">{{ summary(p) }}</span>
          </button>
          <button
            type="button"
            class="presets-row-delete"
            :data-preset-delete="p.name"
            :aria-label="`Delete preset ${p.name}`"
            title="Delete this preset"
            @click="onDelete(p.name)"
          >
            ×
          </button>
        </li>
      </ul>

      <div v-else class="presets-empty">
        <span class="presets-empty-mark" aria-hidden="true">◌</span>
        <p class="presets-empty-title">
          No loadouts on file.
        </p>
        <p class="presets-empty-sub">
          Engage a filter combination, then click <strong>Save current</strong> above
          to lock it in.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Saved-loadouts dropdown — sits in .filter-tools alongside the
   undated/hidden/leaver pills, expands to a tactical spec-plate
   popover anchored top-right. Mirrors the mf-panel chrome from
   FilterRail so the two popovers read as one family. */

.presets-wrap { position: relative; display: inline-flex; }

.presets-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.28rem 0.55rem;
  background: transparent;
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: pointer;
  transition: color 140ms ease, border-color 140ms ease, background 140ms ease;
}

.presets-trigger:hover,
.presets-trigger.active {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft, transparent);
}

.presets-trigger:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.presets-trigger.populated:not(.active, :hover) {
  color: var(--text);
  border-color: var(--border-strong);
}

.presets-glyph {
  display: inline-flex;
  width: 0.95em;
  font-size: 0.85rem;
  line-height: 1;
  opacity: 0.85;
}

.presets-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.1rem;
  padding: 0 0.32rem;
  background: var(--accent);
  color: var(--primary-text-on-accent);
  font-size: 0.62rem;
  font-weight: 700;
  border-radius: 1px;
  font-feature-settings: "tnum";
}

.presets-caret {
  width: 6px;
  height: 6px;
  border-right: 1px solid currentcolor;
  border-bottom: 1px solid currentcolor;
  transform: translateY(-1px) rotate(45deg);
  transition: transform 200ms ease;
}

.presets-wrap.open .presets-caret { transform: translateY(2px) rotate(-135deg); }

/* Popover anchored right so the panel reads back into the filter row
   instead of running off the right edge of the page. */
.presets-panel {
  position: absolute;
  z-index: 50;
  top: calc(100% + 8px);
  right: 0;
  min-width: 320px;
  max-width: 420px;
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: 2px;
  box-shadow:
    0 28px 70px -20px rgb(0 0 0 / 75%),
    0 0 0 1px var(--accent-soft);
  display: flex;
  flex-direction: column;
  max-height: 480px;
  overflow: hidden;
  animation: presets-panel-in 200ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
  transform-origin: top right;
}

@keyframes presets-panel-in {
  from { opacity: 0; transform: translateY(-6px) scale(0.96); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .presets-panel { animation: none; }
}

.presets-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.75rem;
  background: repeating-linear-gradient(135deg, var(--brand-gray) 0 12px, #3a3a3a 12px 24px);
  border-bottom: 1px solid var(--accent);
  color: #f1f1f1;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

.presets-head-title { font-weight: 700; }

.presets-head-meta {
  color: var(--accent);
  letter-spacing: 0.18em;
  font-feature-settings: "tnum";
}

.presets-save-row {
  padding: 0.55rem 0.7rem;
  border-bottom: 1px dashed var(--border);
  background: var(--surface-2);
}

.presets-save-btn {
  display: grid;
  grid-template-columns: 1.8rem 1fr auto;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.7rem;
  background: var(--surface-3);
  border: 1px dashed var(--border-strong);
  border-radius: 2px;
  color: var(--text-dim);
  text-align: left;
  cursor: pointer;
  transition: border-color 140ms ease, background 140ms ease, color 140ms ease;
}

.presets-save-btn:hover:not(:disabled),
.presets-save-btn:focus-visible:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text);
  outline: none;
}

.presets-save-btn.ready { border-style: solid; border-color: var(--accent-soft); color: var(--text); }

.presets-save-btn:disabled { cursor: not-allowed; opacity: 0.55; }

.presets-save-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.4rem;
  height: 1.4rem;
  background: var(--accent);
  color: var(--primary-text-on-accent);
  font-family: var(--mono);
  font-weight: 700;
  font-size: 1rem;
  line-height: 1;
  border-radius: 1px;
}

.presets-save-btn:disabled .presets-save-mark { background: var(--brand-gray); color: #d4d4d4; }

.presets-save-label {
  font-family: var(--display);
  font-style: italic;
  font-size: 1.05rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.presets-save-hint {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-mute);
  white-space: nowrap;
}

.presets-list {
  list-style: none;
  margin: 0;
  padding: 0.25rem 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
  flex: 1 1 auto;
}

.presets-list::-webkit-scrollbar { width: 6px; }
.presets-list::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 3px; }

.presets-row {
  position: relative;
  display: flex;
  gap: 0.35rem;
  padding: 0.1rem 0.45rem;
  transition: background 120ms ease;
}

.presets-row + .presets-row { border-top: 1px dashed var(--hairline); }
.presets-row:hover { background: var(--surface-2); }

.presets-row-apply {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.5rem 0.55rem;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 1px;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}

/* Spec-plate tick that grows on hover — anchors the row's
   "actionable" identity without weighing the default state. */
.presets-row-apply::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 3px;
  height: 0;
  background: var(--accent);
  transform: translateY(-50%);
  transition: height 160ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

.presets-row:hover .presets-row-apply::before,
.presets-row-apply:focus-visible::before { height: 70%; }

.presets-row-apply:focus-visible {
  outline: none;
  border-color: var(--accent);
  background: var(--accent-soft);
}

.presets-row-name {
  font-family: var(--display);
  font-style: italic;
  font-size: 1.05rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1.15;
}

.presets-row-summary {
  font-family: var(--mono);
  font-size: 0.63rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-mute);
  font-feature-settings: "tnum";
}

.presets-row-delete {
  align-self: center;
  width: 1.6rem;
  height: 1.6rem;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 1px;
  color: var(--text-faint);
  font-size: 1rem;
  cursor: pointer;
  transition: color 140ms ease, border-color 140ms ease, background 140ms ease;
}

.presets-row-delete:hover,
.presets-row-delete:focus-visible {
  color: var(--loss);
  border-color: var(--loss);
  background: var(--loss-soft);
  outline: none;
}

.presets-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  padding: 1.2rem 0.9rem 1.3rem;
  text-align: center;
}

.presets-empty-mark {
  font-family: var(--mono);
  font-size: 1.8rem;
  color: var(--text-faint);
}

.presets-empty-title {
  margin: 0;
  font-family: var(--display);
  font-style: italic;
  font-size: 1.05rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.presets-empty-sub {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-faint);
  max-width: 32ch;
  line-height: 1.4;
}

.presets-empty-sub strong { color: var(--accent); font-weight: 600; }
</style>
