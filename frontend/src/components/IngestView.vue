<script setup lang="ts">
import { formatRelativeTime } from '../match-time-helpers'
import type { ParseConnectionState } from '../composables/useParseRecovery'
import ParseProgressPanel, { type ParseProgressEvent } from './ParseProgressPanel.vue'

// IngestView (presented to users as the "Parse" tab) — the
// operational panel. One job: run the parse pipeline. Engine setup,
// backup/restore, and destructive Clear DB live on Settings now —
// this view is reserved for the recurring task a returning user
// actually wants to do.
//
// Two rows:
//   01 Watch Folder — armed-on toggle for hands-free auto-parse
//   02 Manual Parse — one-click "do it now" button + progress panel
//
// Owned state stays in App.vue (tesseractReady, watchEnabled,
// parse-progress stream); this view is a pure presentation layer.

withDefaults(defineProps<{
  // Preflight — needed for the heading state machine + Watch
  // disable. Tesseract status itself lives on Settings.
  tesseractReady:       boolean
  screenshotsDir:       string

  // Parse state
  watchEnabled:         boolean
  parseBusy:              boolean
  // True between the Stop click and the SSE `parse-cancelled`
  // confirmation. Drives the Stop button copy ("Cancelling…") +
  // disabled state so a second click doesn't fire a redundant
  // DELETE request.
  cancellingParse:      boolean
  newScreenshotCount:   number | null
  lastParsedAt:         number | null
  parseProgress:        ParseProgressEvent | null
  parseLog:             ParseProgressEvent[]
  parseProgressOpen:    boolean
  // Server-mode SSE connection state for the parse stream — drives the
  // panel's reconnecting / lost-connection recovery affordances.
  // Optional (defaults to 'connected') so tests + Wails callers can omit.
  parseConnectionState?: ParseConnectionState

  // Record counts — drive heading copy + the "N records on record"
  // line under Manual Parse.
  matchedCount:         number
  unknownCount:         number
}>(), {
  parseConnectionState: 'connected',
})

const emit = defineEmits<{
  'toggle-watch':       []
  'parse':              []
  // Stop click on the in-flight parse. App.vue owns the actual
  // CancelParse() call + the cancellingParse state.
  'cancel-parse':       []
  'toggle-progress':    []
  // Manual recovery from the panel's lost-connection state — re-pull the
  // run-state snapshot + reload. App.vue owns the actual resync.
  'refresh-parse':      []
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
        Tesseract isn't located —
        <button type="button" class="empty-link" @click="emit('go-to-view', 'settings')">
          fix it in Settings → Engine →
        </button>
      </h2>
      <h2 v-else-if="!screenshotsDir" class="settings-heading">
        Set a <em>screenshots folder</em> in
        <button type="button" class="empty-link" @click="emit('go-to-view', 'settings')">
          Settings → Folders →
        </button> first.
      </h2>
      <h2 v-else-if="watchEnabled" class="settings-heading">
        Watching for new screenshots in <em>{{ screenshotsDir }}</em>.
      </h2>
      <h2 v-else-if="matchedCount" class="settings-heading">
        <em>{{ matchedCount }} {{ matchedCount === 1 ? 'match' : 'matches' }}</em> parsed from <em>{{ screenshotsDir }}/</em>
      </h2>
      <h2 v-else class="settings-heading">
        Ready to parse from <em>{{ screenshotsDir }}/</em> — click <em>Run Parse</em> below.
      </h2>
    </header>

    <div id="sec-parse" class="settings-section">
      <div class="section-header">
        <span class="section-num">01</span>
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
              <button type="button" class="empty-link" @click="emit('go-to-view', 'settings')">
                Fix in Settings →
              </button>
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
              <button type="button" class="empty-link" @click="emit('go-to-view', 'settings')">
                Fix in Settings →
              </button>
            </p>
            <p v-else-if="newScreenshotCount === 0 && !parseBusy" class="setting-meta blocked">
              <span class="block-mark" aria-hidden="true">◎</span>
              All screenshots already parsed — nothing new in the folder.
            </p>
            <p
              v-else-if="lastParsedAt && !parseBusy"
              class="setting-meta"
              :title="`Most recent successful parse run on this profile, written to localStorage on parse-complete. Absolute time: ${new Date(lastParsedAt).toLocaleString()}.`"
            >
              <span class="meta-dot" />
              Last run · {{ formatRelativeTime(lastParsedAt) }} · {{ matchedCount + unknownCount }} record{{ (matchedCount + unknownCount) === 1 ? '' : 's' }} on record
            </p>
          </div>
          <div class="setting-control">
            <!-- While a parse is running we swap the primary
                 button for a Stop affordance. The cancellation
                 lands at the next between-files OCR boundary
                 (tesseract is shelled out per file and not
                 context-aware), so the button shows
                 "Cancelling…" between click and the SSE
                 parse-cancelled confirmation. -->
            <button
              v-if="parseBusy"
              class="btn danger big"
              data-testid="cancel-parse-btn"
              :disabled="cancellingParse"
              @click="emit('cancel-parse')"
            >
              <span class="btn-dot" />
              <span v-if="cancellingParse">Cancelling…</span>
              <span v-else>Stop Parse</span>
            </button>
            <button
              v-else
              class="btn primary big"
              :class="{ ghost: tesseractReady && newScreenshotCount === 0 }"
              :disabled="!tesseractReady || newScreenshotCount === 0"
              :title="!tesseractReady ? 'Locate Tesseract in Settings → Engine first.' : newScreenshotCount === 0 ? 'All screenshots in the folder have already been parsed.' : ''"
              @click="emit('parse')"
            >
              <span class="btn-dot" />
              <span v-if="(newScreenshotCount ?? 0) > 0">Run Parse · {{ newScreenshotCount }}</span>
              <span v-else-if="newScreenshotCount === 0 && tesseractReady">All parsed · nothing new</span>
              <span v-else>Run Parse</span>
            </button>
          </div>
        </div>

        <!-- Parse progress panel — visible while parseBusy. -->
        <ParseProgressPanel
          :parse-busy="parseBusy"
          :parse-progress="parseProgress"
          :parse-log="parseLog"
          :is-open="parseProgressOpen"
          :connection-state="parseConnectionState"
          @toggle-open="emit('toggle-progress')"
          @refresh="emit('refresh-parse')"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
/* ─── Big switch (Watch toggle) ──────────────────────────── */

.big-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.85rem;
  cursor: pointer;
  user-select: none;
}

.big-switch input {
  position: absolute;
  width: 0; height: 0;
  opacity: 0;
  pointer-events: none;
}

.big-switch-track {
  position: relative;
  width: 56px; height: 30px;
  background: var(--surface-3);
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  transition: background 240ms ease, border-color 240ms ease, box-shadow 240ms ease;
}

.big-switch-knob {
  position: absolute;
  top: 2px; left: 2px;
  width: 24px; height: 24px;
  background: var(--text-faint);
  border-radius: 50%;
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
  background: var(--accent);
  box-shadow: 0 0 14px var(--accent-glow);
  transform: translateX(26px);
}

.big-switch-state {
  min-width: 3.6rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: var(--text-faint);
  transition: color 220ms ease;
}

.big-switch.on .big-switch-state { color: var(--accent); }

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
  background: var(--win);
  border-radius: 50%;
  box-shadow: 0 0 8px var(--win-line);
  animation: pulse-dot 2.4s ease-in-out infinite;
}

.setting-meta.blocked {
  color: var(--loss);
}

.block-mark {
  margin-right: 0.15rem;
  font-size: 0.85rem;
  filter: saturate(0.85);
}

/* ─── Btn-dot indicator (inside .btn.primary) ────────────── */

.btn-dot {
  width: 6px; height: 6px;
  background: #1a0a00;
  border-radius: 50%;
  box-shadow: 0 0 0 2px rgb(26 10 0 / 25%);
}

/* The "big" CTA bumps the dot proportionally. */
.btn.primary.big .btn-dot {
  width: 7px; height: 7px;
}
</style>
