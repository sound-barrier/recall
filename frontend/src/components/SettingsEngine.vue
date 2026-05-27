<script setup lang="ts">
import type { TesseractStatus } from '../api'

// Engine panel — Tesseract status display + binary picker + "Use
// platform default" reset link. Extracted from SettingsView so the
// status-chip + path-display state + unsupported-version warning
// all live with the component that renders them.
//
// `.engine-*` + `.warn-icon` + `.link-btn` scoped styles move too.

defineProps<{
  tesseractReady?:      boolean
  tesseractSupported?:  boolean
  tesseractStatus?:     TesseractStatus
  tesseractPickerBusy?: boolean
}>()

const emit = defineEmits<{
  'pick-tesseract':  []
  'reset-tesseract': []
}>()
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
            Recall shells out to Tesseract to read text from your Overwatch screenshots. On macOS the Homebrew install lives under <code>/opt/homebrew/bin</code> (Apple Silicon) or <code>/usr/local/bin</code> (Intel); apt installs to <code>/usr/bin</code>; Windows installers put it in <code>Program Files\Tesseract-OCR</code>.
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
            v-if="tesseractStatus && tesseractStatus.default && tesseractStatus.default !== tesseractStatus.path"
            class="engine-meta"
          >
            Default for this platform · <code>{{ tesseractStatus.default }}</code>
            · <button class="link-btn" @click="emit('reset-tesseract')">
              Use default
            </button>
          </p>
        </div>
        <div class="setting-control engine-control">
          <button
            class="btn"
            :class="tesseractReady ? 'ghost' : 'primary'"
            :disabled="tesseractPickerBusy"
            @click="emit('pick-tesseract')"
          >
            <span v-if="tesseractPickerBusy">Locating…</span>
            <span v-else>{{ tesseractReady ? 'Change Binary…' : 'Locate Tesseract…' }}</span>
          </button>
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
