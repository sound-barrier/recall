<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'

import { useScrollLock } from '@/composables/useScrollLock'

// Selection-aware "Export bundle" modal. Opens from the MatchesView
// bulk-action bar. Lets the user:
//   * confirm the destination filename (defaulted to
//     recall-bundle-<timestamp>.zip),
//   * optionally add every hidden match to the checkbox selection,
//   * optionally add every unknown match to the checkbox selection.
// Submits with the final knobs; App.vue dispatches the actual save
// via api.ts ExportBundle (Wails native dialog or browser blob).
//
// Esc / backdrop click both dismiss (unlike the first-run modal,
// this is a soft prompt). Focus trap cycles inside the box.

const props = defineProps<{
  open:           boolean
  selectedCount:  number
  hiddenCount:    number
  unknownCount:   number
}>()

const emit = defineEmits<{
  close: []
  // Caller threads the values back into App.vue's ExportBundle call.
  // Filename is what the user typed (empty string allowed — caller
  // falls back to the timestamp default).
  export: [filename: string, includeHidden: boolean, includeUnknown: boolean]
}>()

// Freeze the page behind the modal (this one wires its own focus trap
// rather than useModalFocusTrap, so it locks scroll directly).
useScrollLock(toRef(props, 'open'))

function defaultFilename(): string {
  // Same shape the server emits via Content-Disposition. Local-time
  // is intentional: the user is naming a file they'll find in their
  // own Finder/Explorer, so the local timestamp reads more
  // naturally than UTC.
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    'recall-bundle-' +
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.zip`
  )
}

const filename       = ref(defaultFilename())
const includeHidden  = ref(false)
const includeUnknown = ref(false)
const busy           = ref(false)

// Reset every time the modal re-opens so a previous run's toggles
// don't surprise the user.
watch(() => props.open, (next) => {
  if (next) {
    filename.value       = defaultFilename()
    includeHidden.value  = false
    includeUnknown.value = false
    busy.value           = false
  }
})

const inputEl = ref<HTMLInputElement | null>(null)

// Final count includes the checkbox selection plus the toggled-in
// sets. Doesn't dedupe (the backend handles dedup), but the rough
// preview number is what the user wants to see.
const previewCount = computed(() => {
  let n = props.selectedCount
  if (includeHidden.value)  n += props.hiddenCount
  if (includeUnknown.value) n += props.unknownCount
  return n
})

const canSubmit = computed(() => {
  if (busy.value) return false
  return previewCount.value > 0
})

async function onSubmit() {
  if (!canSubmit.value) return
  busy.value = true
  try {
    emit('export', filename.value.trim(), includeHidden.value, includeUnknown.value)
  } finally {
    busy.value = false
  }
}

function onCancel() {
  if (busy.value) return
  emit('close')
}

function focusable(): HTMLElement[] {
  const box = document.querySelector<HTMLElement>('.export-bundle-modal-box')
  if (!box) return []
  const sel = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
  return Array.from(box.querySelectorAll<HTMLElement>(sel))
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    onCancel()
    return
  }
  if (e.key !== 'Tab') return
  const items = focusable()
  if (items.length === 0) return
  const first = items[0]!
  const last  = items[items.length - 1]!
  const active = document.activeElement as HTMLElement | null
  if (e.shiftKey && active === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

onMounted(async () => {
  document.addEventListener('keydown', onKeydown)
  await nextTick()
  inputEl.value?.focus({ preventScroll: true })
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    v-if="open"
    class="export-bundle-modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="export-bundle-title"
    aria-describedby="export-bundle-desc"
    data-testid="export-bundle-modal"
  >
    <div class="export-bundle-modal-backdrop" aria-hidden="true" @click="onCancel" />
    <form
      class="export-bundle-modal-box"
      @submit.prevent="onSubmit"
    >
      <p class="export-bundle-eyebrow">
        Data &amp; Export
      </p>
      <h2 id="export-bundle-title" class="export-bundle-title">
        Export bundle
      </h2>
      <p id="export-bundle-desc" class="export-bundle-desc">
        A <code>.zip</code> containing each match's JSON data and
        every referenced screenshot. Restores via Settings →
        Backup &amp; Restore.
      </p>

      <div class="export-bundle-row">
        <span class="export-bundle-label">Selected matches</span>
        <span class="export-bundle-value">{{ selectedCount }}</span>
      </div>

      <label class="export-bundle-toggle">
        <input
          v-model="includeUnknown"
          type="checkbox"
          :disabled="unknownCount === 0"
          data-testid="include-unknown"
        >
        <span>
          Include
          <strong>{{ unknownCount }}</strong>
          unknown match{{ unknownCount === 1 ? '' : 'es' }}
        </span>
      </label>

      <label class="export-bundle-toggle">
        <input
          v-model="includeHidden"
          type="checkbox"
          :disabled="hiddenCount === 0"
          data-testid="include-hidden"
        >
        <span>
          Include
          <strong>{{ hiddenCount }}</strong>
          hidden match{{ hiddenCount === 1 ? '' : 'es' }}
        </span>
      </label>

      <label class="export-bundle-field-label" for="export-bundle-filename">
        Filename
      </label>
      <input
        id="export-bundle-filename"
        ref="inputEl"
        v-model="filename"
        type="text"
        class="export-bundle-input"
        autocomplete="off"
        spellcheck="false"
        required
        :disabled="busy"
        data-testid="filename"
      >

      <p class="export-bundle-preview">
        Bundle will include ~
        <strong>{{ previewCount }}</strong>
        match{{ previewCount === 1 ? '' : 'es' }} total.
      </p>

      <div class="export-bundle-actions">
        <button
          type="button"
          class="export-bundle-cancel"
          :disabled="busy"
          @click="onCancel"
        >
          Cancel
        </button>
        <button
          type="submit"
          class="export-bundle-save"
          :disabled="!canSubmit"
          data-testid="export-submit"
        >
          {{ busy ? 'Exporting…' : 'Export' }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.export-bundle-modal {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}

.export-bundle-modal-backdrop {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--bg) 70%, transparent);
  backdrop-filter: blur(2px);
}

.export-bundle-modal-box {
  position: relative;
  z-index: 1;
  width: min(30rem, 100%);
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: 3px;
  padding: 1.6rem 1.6rem 1.3rem;
  box-shadow:
    0 22px 60px color-mix(in srgb, var(--bg) 70%, transparent),
    0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent);
}

.export-bundle-eyebrow {
  margin: 0 0 0.3rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent-text);
}

.export-bundle-title {
  margin: 0 0 0.6rem;
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', sans-serif;
  font-size: 1.6rem;
  font-style: italic;
  letter-spacing: 0.02em;
  color: var(--text);
}

.export-bundle-desc {
  margin: 0 0 1rem;
  font-size: 0.85rem;
  color: var(--text-faint);
  line-height: 1.5;
}

.export-bundle-desc code {
  font-family: var(--mono);
  font-size: 0.78rem;
  padding: 0.05rem 0.3rem;
  background: var(--surface-2);
  border-radius: 2px;
}

.export-bundle-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0.45rem 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 0.5rem;
}

.export-bundle-label {
  font-family: var(--mono);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.export-bundle-value {
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', sans-serif;
  font-size: 1.1rem;
  font-style: italic;
  color: var(--text);
}

.export-bundle-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0;
  font-size: 0.85rem;
  color: var(--text);
  cursor: pointer;
}

.export-bundle-toggle input[type="checkbox"] {
  accent-color: var(--accent);
  width: 16px;
  height: 16px;
}

.export-bundle-toggle input:disabled + span {
  opacity: 0.5;
  cursor: not-allowed;
}

.export-bundle-field-label {
  display: block;
  margin: 0.8rem 0 0.3rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.export-bundle-input {
  width: 100%;
  padding: 0.55rem 0.7rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.85rem;
  color: var(--text);
}

.export-bundle-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
}

.export-bundle-preview {
  margin: 0.8rem 0 0;
  font-size: 0.8rem;
  color: var(--text-faint);
}

.export-bundle-preview strong {
  color: var(--accent-text);
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', sans-serif;
  font-size: 1rem;
  font-style: italic;
}

.export-bundle-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.1rem;
}

.export-bundle-cancel,
.export-bundle-save {
  appearance: none;
  font-family: var(--mono);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  padding: 0.5rem 0.95rem;
  border-radius: 2px;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}

.export-bundle-cancel {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-faint);
}

.export-bundle-cancel:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--border-strong, var(--text-faint));
}

.export-bundle-save {
  background: var(--accent);
  border: 1px solid var(--accent);
  color: var(--primary-text-on-accent, var(--bg));
}

.export-bundle-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
