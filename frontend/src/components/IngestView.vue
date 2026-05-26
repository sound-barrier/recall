<script setup lang="ts">
import type { TesseractStatus } from '../api'
import { formatRelativeTime } from '../match-helpers'
import ParseProgressPanel, { type ParseProgressEvent } from './ParseProgressPanel.vue'

// IngestView — the parse pipeline tab. Four sections:
//   01 Engine    — Tesseract binary detection / picker
//   02 Parse     — watch-folder toggle, manual Parse, progress panel
//   03 Export    — Prometheus stream toggle
//   04 Data      — destructive Clear-DB with arm/confirm flow
//
// Owned state stays in App.vue (tesseract status, parse progress
// stream, clear-confirm latch); this view is a pure presentation layer
// that bubbles every mutation up via emits.

defineProps<{
  // Engine / preflight
  tesseractReady:       boolean
  tesseractSupported:   boolean
  tesseractStatus:      TesseractStatus
  tesseractPickerBusy:  boolean
  screenshotsDir:       string

  // Parse state
  watchEnabled:         boolean
  loading:              boolean
  newScreenshotCount:   number | null
  lastParsedAt:         number | null
  parseProgress:        ParseProgressEvent | null
  parseLog:             ParseProgressEvent[]
  parseProgressOpen:    boolean

  // Record counts (drive copy + button labels)
  matchedCount:         number
  unknownCount:         number

  // Export
  prometheusEnabled:    boolean

  // Data / destructive
  clearConfirm:         boolean
  clearingDB:           boolean

  // Backup / restore — App.vue holds the in-flight flags + a single
  // status chip that flashes after either action completes. Optional
  // so existing tests that pre-date this row don't have to seed them.
  //
  // `exporting` is a string discriminator ("json" or "csv") so the
  // template can show "Saving…" on whichever format the user clicked,
  // without two parallel boolean flags. Falsy = idle.
  exporting?:           false | 'json' | 'csv'
  importing?:           boolean
  importArmed?:         boolean
  exportStatus?:        { ok: boolean; message: string } | null
}>()

const emit = defineEmits<{
  'pick-tesseract':     []
  'reset-tesseract':    []
  'toggle-watch':       []
  'toggle-prometheus':  []
  'parse':              []
  'arm-clear':          []
  'clear-database':     []
  'cancel-clear':       []
  'export-data':        []
  'export-data-csv':    []
  'arm-import':         []
  'cancel-import':      []
  'import-data':        []
  'toggle-progress':    []
  'go-to-view':         [next: 'settings' | 'ingest' | 'matches' | 'unknown']
}>()
</script>

<template>
  <section id="panel-ingest" role="tabpanel" aria-labelledby="tab-ingest" tabindex="-1" class="settings ingest-view">
    <header class="settings-intro">
      <p class="settings-eyebrow">
        Parse Pipeline
      </p>
      <h2 v-if="!tesseractReady" class="settings-heading missing">
        Recall can't OCR until <em>Tesseract is located</em>.
      </h2>
      <h2 v-else-if="!screenshotsDir" class="settings-heading">
        Set a <em>screenshots folder</em> in
        <button type="button" class="empty-link" @click="emit('go-to-view', 'settings')">
          Settings →
        </button> first.
      </h2>
      <h2 v-else-if="watchEnabled" class="settings-heading">
        Watching <em>{{ screenshotsDir }}/</em> for new screenshots.
      </h2>
      <h2 v-else-if="matchedCount" class="settings-heading">
        <em>{{ matchedCount }} {{ matchedCount === 1 ? 'match' : 'matches' }}</em> parsed from <em>{{ screenshotsDir }}/</em>
      </h2>
      <h2 v-else class="settings-heading">
        Ready to parse from <em>{{ screenshotsDir }}/</em> — click <em>Run Parse</em> below.
      </h2>
    </header>

    <div id="sec-engine" class="settings-section">
      <div class="section-header">
        <span class="section-num">01</span>
        <span class="section-slash" aria-hidden="true">/</span>
        <h3 class="section-title">
          Engine
        </h3>
      </div>
      <div class="setting-rows">
        <div class="setting-row engine-row" :class="{ alert: !tesseractReady }">
          <div class="setting-info">
            <h4 class="setting-label">
              Tesseract Binary
            </h4>
            <p class="setting-desc">
              Recall shells out to Tesseract to read text from your Overwatch screenshots. On macOS the Homebrew install lives under <code>/opt/homebrew/bin</code> (Apple Silicon) or <code>/usr/local/bin</code> (Intel); apt installs to <code>/usr/bin</code>; Windows installers put it in <code>Program Files\Tesseract-OCR</code>.
            </p>
            <div class="engine-status" :class="{ ok: tesseractReady, fail: !tesseractReady }">
              <span class="engine-dot" aria-hidden="true" />
              <span class="engine-state">{{ tesseractReady ? 'Detected' : 'Not Found' }}</span>
              <span v-if="tesseractReady && tesseractStatus.version" class="engine-version">v{{ tesseractStatus.version }}</span>
              <span class="engine-path mono" :title="tesseractStatus.path || ''">{{ tesseractStatus.path || '—' }}</span>
            </div>
            <p v-if="!tesseractReady && tesseractStatus.error" class="engine-error">
              {{ tesseractStatus.error }}
            </p>
            <!-- role="status" (polite live region) rather than role="alert":
                 the warning is informational, not blocking — parsing still
                 works, the user is just on an untested Tesseract version.
                 role="alert" would interrupt screen readers on render. -->
            <div v-if="tesseractReady && !tesseractSupported" class="engine-unsupported-warn" role="status">
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
              v-if="tesseractStatus.default && tesseractStatus.default !== tesseractStatus.path"
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

    <div id="sec-ingest" class="settings-section">
      <div class="section-header">
        <span class="section-num">02</span>
        <span class="section-slash" aria-hidden="true">/</span>
        <h3 class="section-title">
          Parse
        </h3>
      </div>
      <div class="setting-rows">
        <div class="setting-row">
          <div class="setting-info">
            <h4 class="setting-label">
              Watch Folder
            </h4>
            <p class="setting-desc">
              Auto-parse new screenshots as they appear. Recall waits 60 seconds after the last new file, so a 3–4-screenshot post-match session collapses into a single parse.
            </p>
            <p v-if="!tesseractReady" class="setting-meta blocked">
              <span class="block-mark" aria-hidden="true">⛔</span>
              Blocked — needs Tesseract.
            </p>
          </div>
          <div class="setting-control">
            <label class="big-switch" :class="{ on: watchEnabled, disabled: !tesseractReady }">
              <input
                type="checkbox"
                :checked="watchEnabled"
                :disabled="!tesseractReady"
                @change="emit('toggle-watch')"
              >
              <span class="big-switch-track"><span class="big-switch-knob" /></span>
              <span class="big-switch-state">{{ watchEnabled ? 'Armed' : 'Off' }}</span>
            </label>
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <h4 class="setting-label">
              Manual Parse
            </h4>
            <p class="setting-desc">
              Scan the folder now, outside the watcher cycle. Idempotent — re-running won't duplicate matches you've already parsed.
            </p>
            <p v-if="!tesseractReady" class="setting-meta blocked">
              <span class="block-mark" aria-hidden="true">⛔</span>
              Blocked — needs Tesseract.
            </p>
            <p v-else-if="newScreenshotCount === 0 && !loading" class="setting-meta blocked">
              <span class="block-mark" aria-hidden="true">◎</span>
              All screenshots already parsed — nothing new in the folder.
            </p>
            <p v-else-if="lastParsedAt && !loading" class="setting-meta">
              <span class="meta-dot" />
              Last run · {{ formatRelativeTime(lastParsedAt) }} · {{ matchedCount + unknownCount }} record{{ (matchedCount + unknownCount) === 1 ? '' : 's' }} on record
            </p>
          </div>
          <div class="setting-control">
            <button
              class="btn primary big"
              :disabled="loading || !tesseractReady || newScreenshotCount === 0"
              :title="!tesseractReady ? 'Locate Tesseract in section 01 / Engine first.' : newScreenshotCount === 0 ? 'All screenshots in the folder have already been parsed.' : ''"
              @click="emit('parse')"
            >
              <span class="btn-dot" />
              <span v-if="loading">Parsing…</span>
              <span v-else-if="(newScreenshotCount ?? 0) > 0">Run Parse · {{ newScreenshotCount }}</span>
              <span v-else>Run Parse</span>
            </button>
          </div>
        </div>

        <!-- Parse progress panel — visible while loading -->
        <ParseProgressPanel
          :loading="loading"
          :parse-progress="parseProgress"
          :parse-log="parseLog"
          :is-open="parseProgressOpen"
          @toggle-open="emit('toggle-progress')"
        />
      </div>
    </div>

    <div id="sec-export" class="settings-section">
      <div class="section-header">
        <span class="section-num">03</span>
        <span class="section-slash" aria-hidden="true">/</span>
        <h3 class="section-title">
          Export
        </h3>
      </div>
      <div class="setting-rows">
        <div class="setting-row">
          <div class="setting-info">
            <h4 class="setting-label">
              Stream to Grafana
            </h4>
            <p class="setting-desc">
              Expose match history on <code>localhost:9091/metrics</code> so the bundled Prometheus container can scrape it. Off by default — no port is opened until you enable this.
            </p>
          </div>
          <div class="setting-control">
            <label class="big-switch" :class="{ on: prometheusEnabled }">
              <input type="checkbox" :checked="prometheusEnabled" @change="emit('toggle-prometheus')">
              <span class="big-switch-track"><span class="big-switch-knob" /></span>
              <span class="big-switch-state">{{ prometheusEnabled ? 'Live' : 'Off' }}</span>
            </label>
          </div>
        </div>
      </div>
    </div>

    <div id="sec-data" class="settings-section">
      <div class="section-header">
        <span class="section-num">04</span>
        <span class="section-slash" aria-hidden="true">/</span>
        <h3 class="section-title">
          Data
        </h3>
      </div>
      <div class="setting-rows">
        <!-- Backup / restore. Two rows so the surrounding visual rhythm
             stays consistent with the rest of the section. Export is
             non-destructive (one click); Import replaces the DB and
             arms a confirmation just like Clear. The transient
             exportStatus chip flashes after either action. -->
        <div class="setting-row">
          <div class="setting-info">
            <h4 class="setting-label">
              Export Data
            </h4>
            <p class="setting-desc">
              Download a portable backup of every parsed match. <strong>JSON</strong> is the canonical Recall format (smallest, round-trips losslessly); <strong>CSV</strong> exports a ZIP archive of one CSV per table for Excel / Sheets. Both formats round-trip through <strong>Import Data</strong>. Settings + screenshots aren't included.
            </p>
            <p v-if="exportStatus && exportStatus.ok" class="setting-meta success">
              <span class="block-mark" aria-hidden="true">✓</span>
              {{ exportStatus.message }}
            </p>
            <p v-else-if="exportStatus && !exportStatus.ok" class="setting-meta blocked">
              <span class="block-mark" aria-hidden="true">✕</span>
              {{ exportStatus.message }}
            </p>
          </div>
          <div class="setting-control">
            <div class="export-btn-group">
              <button
                class="btn ghost"
                :disabled="!!exporting || importing"
                @click="emit('export-data')"
              >
                <span v-if="exporting === 'json'">Saving…</span>
                <span v-else>JSON</span>
              </button>
              <button
                class="btn ghost"
                :disabled="!!exporting || importing"
                @click="emit('export-data-csv')"
              >
                <span v-if="exporting === 'csv'">Saving…</span>
                <span v-else>CSV</span>
              </button>
            </div>
          </div>
        </div>

        <div class="setting-row" :class="{ 'danger-row': importArmed }">
          <div class="setting-info">
            <h4 class="setting-label">
              Import Data
            </h4>
            <p class="setting-desc">
              Restore from a previously-exported JSON backup. <strong>Replaces</strong> everything currently in the database — local matches that aren't in the backup will be lost.
            </p>
            <p v-if="importArmed" class="setting-meta blocked">
              <span class="block-mark" aria-hidden="true">⚠</span>
              This wipes {{ matchedCount + unknownCount }} record{{ (matchedCount + unknownCount) === 1 ? '' : 's' }} before loading the backup.
            </p>
          </div>
          <div class="setting-control">
            <template v-if="!importArmed">
              <button
                class="btn danger-outline"
                :disabled="importing || !!exporting"
                @click="emit('arm-import')"
              >
                Import Backup…
              </button>
            </template>
            <template v-else>
              <div class="clear-confirm-group">
                <button
                  class="btn danger"
                  :disabled="importing"
                  @click="emit('import-data')"
                >
                  <span v-if="importing">Loading…</span>
                  <span v-else>Choose File…</span>
                </button>
                <button class="btn ghost" :disabled="importing" @click="emit('cancel-import')">
                  Cancel
                </button>
              </div>
            </template>
          </div>
        </div>

        <div class="setting-row" :class="{ 'danger-row': clearConfirm }">
          <div class="setting-info">
            <h4 class="setting-label">
              Clear Parse Database
            </h4>
            <p class="setting-desc">
              Permanently delete all {{ matchedCount + unknownCount }} parsed match record{{ (matchedCount + unknownCount) === 1 ? '' : 's' }} from the local database. Settings and screenshots are untouched — you can re-parse at any time to rebuild from scratch.
            </p>
            <p v-if="clearConfirm" class="setting-meta blocked">
              <span class="block-mark" aria-hidden="true">⚠</span>
              This cannot be undone.
            </p>
          </div>
          <div class="setting-control">
            <template v-if="!clearConfirm">
              <button
                class="btn danger-outline"
                :disabled="clearingDB || (matchedCount + unknownCount) === 0"
                @click="emit('arm-clear')"
              >
                Clear Database…
              </button>
            </template>
            <template v-else>
              <div class="clear-confirm-group">
                <button
                  class="btn danger"
                  :disabled="clearingDB"
                  @click="emit('clear-database')"
                >
                  <span v-if="clearingDB">Deleting…</span>
                  <span v-else>Delete {{ matchedCount + unknownCount }} Record{{ (matchedCount + unknownCount) === 1 ? '' : 's' }}</span>
                </button>
                <button class="btn ghost" :disabled="clearingDB" @click="emit('cancel-clear')">
                  Cancel
                </button>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* ─── Engine status panel ────────────────────────────────── */

.engine-row { transition: background 220ms ease; }
.engine-row.alert { background: var(--loss-soft); }
.engine-row.alert::before { background: var(--loss); box-shadow: 0 0 10px var(--loss-line); }

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
.engine-status.ok   { border-color: var(--win-line); background: var(--win-soft); }
.engine-status.fail { border-color: var(--loss-line); background: var(--loss-soft); }

.engine-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--text-faint);
  flex-shrink: 0;
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
.engine-status.ok .engine-state   { color: var(--win); }
.engine-status.fail .engine-state { color: var(--loss); }

.engine-version {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text-dim);
  padding: 0.1rem 0.4rem;
  background: var(--surface-3);
  border-radius: 2px;
  font-feature-settings: "tnum";
}

.engine-path {
  font-family: var(--mono);
  font-size: 0.75rem;
  color: var(--text-dim);
  word-break: break-all;
  letter-spacing: 0;
  flex: 1 1 auto;
  min-width: 0;
}

.engine-error {
  margin-top: 0.55rem;
  font-family: var(--body);
  font-size: 0.82rem;
  color: var(--loss);
  line-height: 1.5;
  max-width: 60ch;
}

.engine-meta {
  margin-top: 0.55rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-faint);
  letter-spacing: 0.04em;
}

.engine-meta code {
  font-family: var(--mono);
  font-size: 0.7rem;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  padding: 0.05rem 0.35rem;
  border-radius: 2px;
  color: var(--text-dim);
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
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  border-radius: 3px;
  font-family: var(--body);
  font-size: 0.8rem;
  color: color-mix(in srgb, var(--accent) 80%, var(--text));
  line-height: 1.55;
  max-width: 60ch;
}

.engine-unsupported-warn .warn-icon {
  flex-shrink: 0;
  margin-top: 0.12rem;
  color: var(--accent);
}

/* ─── Big switch (Watch toggle) ──────────────────────────── */

.big-switch {
  display: inline-flex;
  align-items: center;
  gap: 0.85rem;
  cursor: pointer;
  user-select: none;
  position: relative;
}

.big-switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
  width: 0; height: 0;
}

.big-switch-track {
  position: relative;
  width: 56px; height: 30px;
  border-radius: 999px;
  background: var(--surface-3);
  border: 1px solid var(--border-strong);
  transition: background 240ms ease, border-color 240ms ease, box-shadow 240ms ease;
}

.big-switch-knob {
  position: absolute;
  top: 2px; left: 2px;
  width: 24px; height: 24px;
  border-radius: 50%;
  background: var(--text-faint);
  transition:
    transform 260ms cubic-bezier(0.4, 0.0, 0.2, 1),
    background 240ms ease,
    box-shadow 240ms ease;
}

.big-switch.on .big-switch-track {
  background: var(--accent-soft);
  border-color: var(--accent);
  box-shadow: 0 0 18px -2px var(--accent-glow);
}

.big-switch.on .big-switch-track .big-switch-knob {
  transform: translateX(26px);
  background: var(--accent);
  box-shadow: 0 0 14px var(--accent-glow);
}

.big-switch-state {
  font-family: var(--mono);
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: var(--text-faint);
  min-width: 3.6rem;
  transition: color 220ms ease;
}

.big-switch.on .big-switch-state {
  color: var(--accent);
}

.big-switch:focus-within .big-switch-track {
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-soft), 0 0 18px -2px var(--accent-glow);
}

/* Disabled state for big-switch (used by Watch when Tesseract is missing). */
.big-switch.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.big-switch.disabled .big-switch-track { background: var(--surface-2); border-color: var(--border); }
.big-switch.disabled .big-switch-knob { background: var(--text-mute); box-shadow: none; }

/* ─── Setting-meta + "blocked" variant ───────────────────── */

.setting-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.55rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-faint);
  letter-spacing: 0.04em;
  font-feature-settings: "tnum";
}

.meta-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--win);
  box-shadow: 0 0 8px var(--win-line);
  animation: pulse-dot 2.4s ease-in-out infinite;
}

/* "Blocked — needs Tesseract" meta line under Watch / Manual Parse
   when those controls are gated. */
.setting-meta.blocked {
  color: var(--loss);
}

/* "Saved: /path/..." flash after an Export / Import succeeds. Echoes
   the same chip footprint as .blocked but in the accent/win color. */
.setting-meta.success {
  color: var(--win);
}

.block-mark {
  font-size: 0.85rem;
  margin-right: 0.15rem;
  filter: saturate(0.85);
}

/* ─── Inline link-as-button (for "Use default" cue, etc.) ── */

.link-btn {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  font: inherit;
  color: var(--accent);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-thickness: 1px;
  text-decoration-color: var(--accent-soft);
  transition: text-decoration-color 200ms ease, color 200ms ease;
}

.link-btn:hover {
  text-decoration-color: var(--accent);
}
:global([data-theme="light"]) .link-btn { color: var(--accent-text); }
:global([data-theme="light"]) .link-btn:hover { text-decoration-color: var(--accent-text); }

/* ─── Btn-dot indicator (inside .btn.primary) ────────────── */

.btn-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #1a0a00;
  box-shadow: 0 0 0 2px rgb(26 10 0 / 25%);
}

/* The "big" CTA bumps the dot proportionally. */
.btn.primary.big .btn-dot {
  width: 7px; height: 7px;
}

/* ─── Confirm-state row (Clear DB destructive flow) ──────── */

.setting-row.danger-row {
  border-left: 3px solid var(--loss-line);
  padding-left: calc(1.4rem - 3px);
  background: var(--loss-soft);
  border-radius: 2px;
  transition: background 200ms ease, border-color 200ms ease;
}

:global([data-theme="light"]) .setting-row.danger-row { background: var(--loss-soft); }

.clear-confirm-group {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.5rem;
}

/* Side-by-side "JSON | CSV" buttons in the Export Data row. Mono
   labels, tight gap — reads as a format picker, not two unrelated
   actions. The buttons share a 1px hairline divider via a pseudo
   element on the second so the pair feels like one control. */
.export-btn-group {
  display: inline-flex;
  gap: 0.4rem;
  align-items: stretch;
}

.export-btn-group .btn {
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 0.4rem 0.95rem;
}
</style>
