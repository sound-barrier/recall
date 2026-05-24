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
            <div v-if="tesseractReady && !tesseractSupported" class="engine-unsupported-warn" role="alert">
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
