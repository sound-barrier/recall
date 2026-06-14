<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { TesseractStatus } from '@/api'

// Engine panel — Tesseract status display + Detect / Change / Reset
// button cluster mirroring the screenshots-dir affordances. Extracted
// from SettingsView so the status-chip + path-display state + probe-
// chip + unsupported-version warning all live with the component that
// renders them.
//
// `.engine-*` + `.warn-icon` + `.link-btn` scoped styles move too.

const props = defineProps<{
  tesseractReady?:      boolean
  tesseractSupported?:  boolean
  tesseractStatus?:     TesseractStatus
  tesseractPickerBusy?: boolean
  // Detect-button state — shared shape with screenshots-dir probe so
  // both rows render the same chip + "Looked in" disclosure.
  tesseractProbing?:      boolean
  tesseractProbeMessage?: string
  tesseractProbeStatus?:  '' | 'success' | 'blocked'
  tesseractProbeTried?:   string[]
}>()

const emit = defineEmits<{
  'pick-tesseract':   []
  'reset-tesseract':  []
  'detect-tesseract': []
}>()

// Reset is meaningful only when the current path differs from the
// platform default — there's no override to clear otherwise.
const hasOverride = computed(() =>
  !!props.tesseractStatus
    && !!props.tesseractStatus.default
    && props.tesseractStatus.path !== props.tesseractStatus.default,
)

// Probe-chip dismissal — same shape as SettingsFolders. Reset every
// time a fresh probeMessage lands so a second Detect click re-opens
// the chip rather than leaving the stale "dismissed" state.
const probeDismissed = ref(false)
watch(() => props.tesseractProbeMessage, (next) => {
  if (next) probeDismissed.value = false
})
const showProbeChip = computed(
  () => !!props.tesseractProbeMessage && !probeDismissed.value,
)
</script>

<template>
  <div id="sec-engine" class="settings-section">
    <div class="section-header">
      <span class="section-num">02</span>
      <span class="section-slash" aria-hidden="true">/</span>
      <h3 class="section-title">
        Engine
      </h3>
    </div>
    <div class="setting-rows">
      <div class="setting-row engine-row" :class="{ alert: tesseractReady === false }">
        <div class="setting-info">
          <h4 class="setting-label">
            Tesseract Binary
            <span class="setting-help" tabindex="0" role="note">
              <span class="setting-help-mark" aria-hidden="true">?</span>
              <span class="setting-help-label">About Tesseract</span>
              <span class="setting-help-pop" role="tooltip">
                Recall reads text out of your screenshots by calling the open-source Tesseract OCR engine. Install once per machine — Recall finds the binary on its own most of the time.
              </span>
            </span>
          </h4>
          <p class="setting-desc">
            Recall shells out to Tesseract to read text from your Overwatch screenshots.
            <template v-if="tesseractStatus?.platform === 'darwin'">
              The Homebrew install lives under <code>/opt/homebrew/bin</code> (Apple Silicon) or <code>/usr/local/bin</code> (Intel).
            </template>
            <template v-else-if="tesseractStatus?.platform === 'linux'">
              The apt install lives at <code>/usr/bin</code>.
            </template>
            <template v-else-if="tesseractStatus?.platform === 'windows'">
              The installer puts it in <code>Program Files\Tesseract-OCR</code>.
            </template>
          </p>
          <div v-if="tesseractStatus" class="engine-status" :class="{ ok: tesseractReady, fail: !tesseractReady }">
            <span class="engine-dot" aria-hidden="true" />
            <span class="engine-state">{{ tesseractReady ? 'Detected' : 'Not Found' }}</span>
            <span v-if="tesseractReady && tesseractStatus.version" class="engine-version">v{{ tesseractStatus.version }}</span>
            <span class="engine-path mono" :title="tesseractStatus.path || ''">{{ tesseractStatus.path || '—' }}</span>
          </div>
          <p v-if="tesseractStatus && !tesseractReady && tesseractStatus.error" class="engine-error">
            {{ tesseractStatus.error }}
          </p>
          <div v-if="tesseractStatus && tesseractReady && !tesseractSupported" class="engine-unsupported-warn" role="status">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" class="warn-icon">
              <path d="M12 2.6 L22.4 20.5 L1.6 20.5 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
              <line x1="12" y1="10" x2="12" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              <circle cx="12" cy="17.5" r="1.2" fill="currentColor" />
            </svg>
            <span>
              Tesseract {{ tesseractStatus.version }} is not officially supported. Only version 5.x is tested with Recall.
              Proceed at your own caution — results may be incorrect.
            </span>
          </div>
          <p
            v-if="tesseractStatus && tesseractStatus.default && hasOverride"
            class="engine-meta"
          >
            Default for this platform · <code>{{ tesseractStatus.default }}</code>
          </p>
          <div v-if="showProbeChip" class="probe-chip" :class="tesseractProbeStatus" role="status">
            <span class="probe-chip-bar" aria-hidden="true" />
            <span class="probe-chip-mark" aria-hidden="true">
              {{ tesseractProbeStatus === 'success' ? '✓' : '⚠' }}
            </span>
            <span class="probe-chip-text">{{ tesseractProbeMessage }}</span>
            <button
              type="button"
              class="probe-chip-close"
              aria-label="Dismiss"
              @click="probeDismissed = true"
            >
              ×
            </button>
          </div>
          <details
            v-if="tesseractProbeStatus === 'blocked' && !probeDismissed && (tesseractProbeTried?.length ?? 0) > 0"
            class="probe-tried"
          >
            <summary>Looked in</summary>
            <ol class="probe-tried-list">
              <li v-for="(p, i) in (tesseractProbeTried ?? [])" :key="i" class="mono">
                {{ p }}
              </li>
            </ol>
          </details>
        </div>
        <div class="setting-control engine-control">
          <div class="engine-btn-group">
            <!-- Detect: enabled + primary when not ready (the
                 recommended action — auto-find the binary); disabled
                 when ready (parallel with the screenshots-dir Detect
                 staying disabled once a folder is set). -->
            <button
              class="btn tiny detect-btn"
              :class="tesseractReady ? 'ghost' : 'primary'"
              :disabled="tesseractReady || tesseractProbing || tesseractPickerBusy"
              :title="tesseractReady ? 'Reset to platform default first to re-detect' : 'Search the usual install locations for Tesseract'"
              @click="emit('detect-tesseract')"
            >
              <span v-if="tesseractProbing">Detecting…</span>
              <span v-else>Detect</span>
            </button>
            <button
              class="btn ghost tiny"
              :disabled="tesseractPickerBusy"
              @click="emit('pick-tesseract')"
            >
              <span v-if="tesseractPickerBusy">Locating…</span>
              <span v-else>Change Binary…</span>
            </button>
            <button
              class="btn ghost tiny reset-btn"
              :disabled="!hasOverride || tesseractPickerBusy"
              :title="hasOverride ? 'Restore the platform default path' : 'Already using the platform default'"
              @click="emit('reset-tesseract')"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.engine-row {
  transition: background 220ms ease;
}

.engine-row.alert {
  background: var(--loss-soft);
}

.engine-row.alert::before {
  background: var(--loss);
  box-shadow: 0 0 10px var(--loss-line);
}

.engine-status {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-top: 0.7rem;
  padding: 0.45rem 0.7rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  max-width: 100%;
}

.engine-status.ok {
  border-color: var(--win-line);
  background: var(--win-soft);
}

.engine-status.fail {
  border-color: var(--loss-line);
  background: var(--loss-soft);
}

.engine-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  background: var(--text-faint);
  border-radius: 50%;
}

.engine-status.ok .engine-dot {
  background: var(--win);
  box-shadow: 0 0 10px var(--win-line);
  animation: pulse-dot 2.4s ease-in-out infinite;
}

.engine-status.fail .engine-dot {
  background: var(--loss);
  box-shadow: 0 0 10px var(--loss-line);
  animation: pulse-dot 1.4s ease-in-out infinite;
}

.engine-state {
  font-family: var(--mono);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

.engine-status.ok .engine-state {
  color: var(--win);
}

.engine-status.fail .engine-state {
  color: var(--loss);
}

.engine-version {
  padding: 0.1rem 0.4rem;
  background: var(--surface-3);
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text-dim);
  font-feature-settings: "tnum";
  border-radius: 2px;
}

.engine-path {
  flex: 1 1 auto;
  min-width: 0;
  font-family: var(--mono);
  font-size: 0.75rem;
  color: var(--text-dim);
  word-break: break-all;
  letter-spacing: 0;
}

.engine-error {
  margin-top: 0.55rem;
  max-width: 60ch;
  font-family: var(--body);
  font-size: 0.82rem;
  color: var(--loss);
  line-height: 1.5;
}

.engine-meta {
  margin-top: 0.55rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-faint);
  letter-spacing: 0.04em;
}

.engine-meta code {
  padding: 0.05rem 0.35rem;
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-dim);
  border: 1px solid var(--border-soft);
  border-radius: 2px;
}

.engine-control {
  align-items: flex-end;
}

/* Three-button cluster mirroring SettingsFolders' .folder-btn-group. */
.engine-btn-group {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.4rem;
}

.engine-btn-group .detect-btn:not(:disabled).primary {
  border-color: var(--accent);
}

.engine-btn-group .detect-btn:not(:disabled).ghost {
  border-color: var(--accent);
  color: var(--accent);
}

.engine-btn-group .detect-btn:not(:disabled).ghost:hover {
  background: var(--accent-soft);
  border-color: var(--accent);
}

.engine-unsupported-warn {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin-top: 0.6rem;
  padding: 0.6rem 0.85rem;
  max-width: 60ch;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  border-radius: 3px;
  font-family: var(--body);
  font-size: 0.8rem;
  color: color-mix(in srgb, var(--accent) 80%, var(--text));
  line-height: 1.55;
}

.engine-unsupported-warn .warn-icon {
  flex-shrink: 0;
  margin-top: 0.12rem;
  color: var(--accent);
}

.link-btn {
  margin: 0;
  padding: 0;
  background: none;
  font: inherit;
  color: var(--accent);
  border: none;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-color: var(--accent-soft);
  text-decoration-thickness: 1px;
  transition: text-decoration-color 200ms ease, color 200ms ease;
}

.link-btn:hover {
  text-decoration-color: var(--accent);
}

/* Light-mode override for .link-btn lives in app.css — see note
   above the .settings-section::after override for why. */
</style>
