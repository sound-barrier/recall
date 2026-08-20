<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, toRef, watch } from 'vue'

import { useScrollLock } from '@/composables/shared/keyboard/useScrollLock'
import type { ExportBundleRequest } from '@/composables/matches/useExportBundle'

// Selection-aware "Export bundle" modal — a BACKUP, and only that. Opens
// from the MatchesView bulk-action bar; confirms the destination filename
// and optionally folds in every hidden or unknown match. useExportBundle
// dispatches the save via api.ts ExportBundle (Wails native dialog or
// browser blob).
//
// Sending matches to a COACH used to be a checkbox in here, which is why
// nobody found it. It has its own dialog now (SendToCoachModal) — one
// dialog, one job, and no way to hand a coach the wrong file.
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
  // Caller threads the request into its ExportBundle call. Filename is what
  // the user typed; an empty string falls back to the timestamp default.
  export: [request: ExportBundleRequest]
}>()

// Freeze the page behind the modal (this one wires its own focus trap
// rather than useModalFocusTrap, so it locks scroll directly).
useScrollLock(toRef(props, 'open'))

function defaultFilename(): string {
  // Same shape the server emits via Content-Disposition. Local-time
  // is intentional: the user is naming a file they'll find in their
  // own Finder/Explorer, so the local timestamp reads more
  // naturally than UTC. The stem differs by mode so the two files are
  // told apart in a folder weeks later.
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

// Declared ahead of the open-watch below: that watch runs immediately
// (see its note), so both refs must already be initialized when it does.
const inputEl = ref<HTMLInputElement | null>(null)
const lastFocus = ref<HTMLElement | null>(null)

// Reset every time the modal re-opens so a previous run's toggles
// don't surprise the user.
//
// `immediate` is load-bearing, not tidiness: this component is a
// defineAsyncComponent overlay, so it can mount with `open` ALREADY
// true (the chunk resolving after the user clicked "Export bundle…").
// Without it the open transition is never observed on that path and the
// Esc handler, the Tab trap, and the focus hand-off are all never wired.
// An immediate run with open=false is a no-op: `prev` is undefined, so
// the close branch below can't fire either.
watch(() => props.open, async (next, prev) => {
  if (next) {
    filename.value       = defaultFilename()
    includeHidden.value  = false
    includeUnknown.value = false
    busy.value           = false
    lastFocus.value =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.addEventListener('keydown', onKeydown)
    await nextTick()
    inputEl.value?.focus({ preventScroll: true })
  } else if (prev) {
    document.removeEventListener('keydown', onKeydown)
    await nextTick()
    lastFocus.value?.focus()
    lastFocus.value = null
  }
}, { immediate: true })

// Final count includes the checkbox selection plus the toggled-in
// sets. Doesn't dedupe (the backend handles dedup), but the rough
// preview number is what the user wants to see.
const previewCount = computed(() => {
  let n = props.selectedCount
  if (includeHidden.value)  n += props.hiddenCount
  if (includeUnknown.value) n += props.unknownCount
  return n
})

const canSubmit = computed(() => !busy.value && previewCount.value > 0)

// A disabled button that will not say why is a dead end.
const submitBlockedReason = computed(() =>
  (busy.value || canSubmit.value ? undefined : 'Nothing selected to export.'))

async function onSubmit() {
  if (!canSubmit.value) return
  busy.value = true
  try {
    emit('export', {
      filename: filename.value.trim(),
      includeHidden: includeHidden.value,
      includeUnknown: includeUnknown.value,
    })
  } finally {
    busy.value = false
  }
}

function onCancel() {
  if (busy.value) return
  emit('close')
}

function focusable(): HTMLElement[] {
  const box = document.querySelector<HTMLElement>('.export-bundle-box')
  if (!box) return []
  const sel = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
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

onBeforeUnmount(() => {
  // The open-watch owns add/remove; this covers unmount-while-open.
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    v-if="open"
    class="sheet-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="export-bundle-title"
    aria-describedby="export-bundle-desc"
    data-testid="export-bundle-modal"
  >
    <div class="sheet-backdrop" aria-hidden="true" @click="onCancel" />
    <form
      class="sheet-box export-bundle-box"
      @submit.prevent="onSubmit"
    >
      <p class="eyebrow accent sheet-fixed export-bundle-eyebrow">
        Data &amp; Export
      </p>
      <h2 id="export-bundle-title" class="sheet-fixed export-bundle-title">
        Export bundle
      </h2>
      <p id="export-bundle-desc" class="sheet-fixed export-bundle-desc">
        A <code>.zip</code> containing each match's JSON data and
        every referenced screenshot.
        Restores via Settings → Backup &amp; Restore.
      </p>

      <div class="sheet-body">
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
      </div>

      <div class="sheet-fixed export-bundle-actions">
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
          :title="submitBlockedReason"
          data-testid="export-submit"
        >
          {{ busy ? 'Exporting…' : 'Export' }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
/* Shape comes from the .sheet-* family in styles/system-alert.css — capped,
   pinned head and actions, only the middle scrolls. This dialog is why that
   family exists: it shipped with none of the three rules and was a trap at
   any window under ~840px. Only its width is its own. */
.export-bundle-box {
  width: min(30rem, 100%);
}

.export-bundle-eyebrow {
  margin: 0 0 0.3rem;
}

.export-bundle-title {
  margin: 0 0 0.6rem;
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', sans-serif;
  font-size: var(--type-7xl);
  font-style: italic;
  letter-spacing: 0.02em;
  color: var(--text);
}

.export-bundle-desc {
  margin: 0 0 1rem;
  font-size: var(--type-lg);
  color: var(--text-faint);
  line-height: 1.5;
}

.export-bundle-desc code {
  font-family: var(--mono);
  font-size: var(--type-md);
  padding: 0.05rem 0.3rem;
  background: var(--surface-2);
  border-radius: var(--radius);
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
  font-size: var(--type-2xs);
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.export-bundle-value {
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', sans-serif;
  font-size: var(--type-3xl);
  font-style: italic;
  color: var(--text);
}

.export-bundle-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0.35rem 0;
  font-size: var(--type-lg);
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
  font-size: var(--type-2xs);
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
  border-radius: var(--radius);
  font-family: var(--mono);
  font-size: var(--type-lg);
  color: var(--text);
}

.export-bundle-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
}

.export-bundle-preview {
  margin: 0.8rem 0 0;
  font-size: var(--type-md);
  color: var(--text-faint);
}

.export-bundle-preview strong {
  color: var(--accent-text);
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', sans-serif;
  font-size: var(--type-2xl);
  font-style: italic;
}

.export-bundle-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: 1.1rem;
}

.export-bundle-cancel,
.export-bundle-save {
  appearance: none;
  font-family: var(--mono);
  font-size: var(--type-sm);
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  padding: 0.5rem 0.95rem;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background var(--duration-fast) ease, color var(--duration-fast) ease, border-color var(--duration-fast) ease;
}

.export-bundle-cancel {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-faint);
}

.export-bundle-cancel:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--border-strong);
}

.export-bundle-save {
  background: var(--accent);
  border: 1px solid var(--accent);
  color: var(--primary-text-on-accent);
}

.export-bundle-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
