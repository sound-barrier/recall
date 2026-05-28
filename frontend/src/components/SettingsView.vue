<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { ThemeMode } from '../composables/useTheme'
import type { WeekStart } from '../composables/useWeekStart'
import type { DataLocation, TesseractStatus } from '../api'
import SettingsAdvanced from './SettingsAdvanced.vue'
import SettingsAppearance from './SettingsAppearance.vue'
import SettingsBackupRestore from './SettingsBackupRestore.vue'
import SettingsCalendar from './SettingsCalendar.vue'
import SettingsEngine from './SettingsEngine.vue'
import SettingsFolders from './SettingsFolders.vue'

// SettingsView — every knob a user might want to touch, sorted by
// frequency of first-time use:
//   01 Folders          — Screenshots Folder + Data Location
//   02 Engine           — Tesseract Binary (one-time setup)
//   03 Appearance       — Day/Night swatches
//   04 Calendar         — First Day of Week
//   05 Backup & Restore — Export JSON/CSV + Import Backup
//   06 Advanced         — Stream to Grafana + Clear Database
//                          (collapsed behind a <details> by default)
//
// Engine, Backup & Restore, and Advanced used to live on the Ingest
// tab — moved here so casual users see a single config destination
// and the Ingest tab can focus on one job: "run a parse." The Wails
// runtime alert banner still deep-links to `#sec-engine` to fix a
// missing Tesseract.

const props = defineProps<{
  screenshotsDir: string
  watchEnabled?:  boolean
  loading:        boolean
  themeMode:      ThemeMode
  weekStart:      WeekStart
  // Nullable + optional: App.vue's load() is async, so the row's
  // paths render `null` for a beat at mount time. Existing tests
  // that don't care can omit this prop entirely.
  dataLocation?:  DataLocation | null
  // "Detect Overwatch Folder" state, owned by App.vue. `probing`
  // disables the button while the probe is in flight;
  // `probeMessage` renders the result chip; `probeStatus` drives
  // success/blocked styling; `probeTried` populates the "Looked in"
  // details disclosure on the blocked path. All optional so older
  // tests / sibling mounts can ignore.
  probing?:       boolean
  probeMessage?:  string
  probeStatus?:   '' | 'success' | 'blocked'
  probeTried?:    string[]
  // Engine section — moved from IngestView. All optional so the
  // existing test cases that mount SettingsView with only the
  // first four props still pass.
  tesseractReady?:      boolean
  tesseractSupported?:  boolean
  tesseractStatus?:     TesseractStatus
  tesseractPickerBusy?: boolean
  // Backup & Restore section — flash chip + arm/confirm state.
  matchedCount?: number
  unknownCount?: number
  exporting?:    false | 'json' | 'csv'
  importing?:    boolean
  importArmed?:  boolean
  exportStatus?: { ok: boolean; message: string } | null
  // Advanced section — Grafana stream toggle + destructive Clear DB.
  prometheusEnabled?: boolean
  clearConfirm?:      boolean
  clearingDB?:        boolean
}>()

const emit = defineEmits<{
  'pick-screenshots-dir':   []
  'detect-screenshots-dir': []
  'toggle-theme':           []
  'set-week-start':         [next: WeekStart]
  'go-to-view':             [next: 'settings' | 'ingest' | 'matches' | 'unknown']
  // Engine
  'pick-tesseract':         []
  'reset-tesseract':        []
  // Backup & Restore
  'export-data':            []
  'export-data-csv':        []
  'arm-import':             []
  'cancel-import':          []
  'import-data':            []
  // Advanced
  'toggle-prometheus':      []
  'arm-clear':              []
  'clear-database':         []
  'cancel-clear':           []
}>()

function onDetect() {
  emit('detect-screenshots-dir')
}

// Probe-chip dismissal — local-only transient UI noise. Reset
// whenever a fresh probeMessage lands so a second Detect click
// re-opens the chip without forcing the user to scroll for it.
// (Used by the first-run empty-hero below; the steady-state
// Folders panel owns its own copy in SettingsFolders.vue.)
const probeDismissed = ref(false)
watch(() => props.probeMessage, (next) => {
  if (next) probeDismissed.value = false
})
const showProbeChip = computed(() => !!props.probeMessage && !probeDismissed.value)

</script>

<template>
  <section id="panel-settings" role="tabpanel" aria-labelledby="tab-settings" tabindex="-1" class="settings">
    <header class="settings-intro">
      <p class="settings-eyebrow">
        System Configuration
      </p>
      <h2 v-if="!screenshotsDir" class="settings-heading">
        Choose a <em>screenshots folder</em> to begin.
      </h2>
      <h2 v-else class="settings-heading">
        Where Recall reads from, and how it looks.
      </h2>
      <p class="settings-sub">
        Run a parse — armed watch or one-click manual — from
        <button type="button" class="empty-link" @click="emit('go-to-view', 'ingest')">
          Parse →
        </button>.
      </p>
    </header>

    <!-- First-run hero — sits ABOVE section 01 so the empty-state
         heading's call-to-action ("choose a screenshots folder")
         has a primary affordance directly underneath it instead of
         being buried inside row 1 of section 1. Disappears once a
         folder is configured; from then on the regular Screenshots
         Folder row owns this concern. -->
    <div v-if="!screenshotsDir" class="empty-hero">
      <div class="empty-hero-marker" aria-hidden="true">
        <span class="empty-hero-corner empty-hero-corner-tl" />
        <span class="empty-hero-corner empty-hero-corner-tr" />
        <span class="empty-hero-corner empty-hero-corner-bl" />
        <span class="empty-hero-corner empty-hero-corner-br" />
      </div>
      <p class="empty-hero-eyebrow">
        First-Time Setup
      </p>
      <h3 class="empty-hero-title">
        Point Recall at your Overwatch screenshots.
      </h3>
      <p class="empty-hero-desc">
        Recall can auto-detect the default Overwatch screenshots folder on this platform, or you can point it at a custom directory. The folder gets watched for new <code>.png</code> files and parsed on save.
      </p>
      <div class="empty-hero-actions">
        <button
          class="btn primary"
          :disabled="loading || probing"
          @click="onDetect"
        >
          <svg viewBox="0 0 24 24" class="btn-icon" aria-hidden="true">
            <circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
          <span v-if="probing">Detecting…</span>
          <span v-else>Auto-Detect Folder</span>
        </button>
        <button class="btn ghost" :disabled="loading" @click="emit('pick-screenshots-dir')">
          Choose Manually
        </button>
      </div>
      <div v-if="showProbeChip" class="probe-chip" :class="probeStatus" role="status">
        <span class="probe-chip-bar" aria-hidden="true" />
        <span class="probe-chip-mark" aria-hidden="true">
          {{ probeStatus === 'success' ? '✓' : '⚠' }}
        </span>
        <span class="probe-chip-text">{{ probeMessage }}</span>
        <button
          type="button"
          class="probe-chip-close"
          aria-label="Dismiss"
          @click="probeDismissed = true"
        >
          ×
        </button>
      </div>
      <details v-if="probeStatus === 'blocked' && !probeDismissed && (probeTried?.length ?? 0) > 0" class="probe-tried">
        <summary>Looked in</summary>
        <ol class="probe-tried-list">
          <li v-for="(p, i) in (probeTried ?? [])" :key="i" class="mono">
            {{ p }}
          </li>
        </ol>
      </details>
    </div>

    <SettingsFolders
      :screenshots-dir="screenshotsDir"
      :watch-enabled="watchEnabled"
      :loading="loading"
      :data-location="dataLocation"
      :probing="probing"
      :probe-message="probeMessage"
      :probe-status="probeStatus"
      :probe-tried="probeTried"
      @pick-screenshots-dir="() => emit('pick-screenshots-dir')"
      @detect-screenshots-dir="() => emit('detect-screenshots-dir')"
    />

    <SettingsEngine
      :tesseract-ready="tesseractReady"
      :tesseract-supported="tesseractSupported"
      :tesseract-status="tesseractStatus"
      :tesseract-picker-busy="tesseractPickerBusy"
      @pick-tesseract="() => emit('pick-tesseract')"
      @reset-tesseract="() => emit('reset-tesseract')"
    />

    <SettingsAppearance
      :theme-mode="themeMode"
      @toggle-theme="() => emit('toggle-theme')"
    />

    <SettingsCalendar
      :week-start="weekStart"
      @set-week-start="(v: WeekStart) => emit('set-week-start', v)"
      @go-to-view="(v: 'settings' | 'ingest' | 'matches' | 'unknown') => emit('go-to-view', v)"
    />

    <SettingsBackupRestore
      :exporting="exporting"
      :importing="importing"
      :import-armed="importArmed"
      :export-status="exportStatus"
      :matched-count="matchedCount"
      :unknown-count="unknownCount"
      @export-data="() => emit('export-data')"
      @export-data-csv="() => emit('export-data-csv')"
      @arm-import="() => emit('arm-import')"
      @import-data="() => emit('import-data')"
      @cancel-import="() => emit('cancel-import')"
    />

    <SettingsAdvanced
      :prometheus-enabled="prometheusEnabled"
      :clearing-d-b="clearingDB"
      :clear-confirm="clearConfirm"
      :matched-count="matchedCount"
      :unknown-count="unknownCount"
      @toggle-prometheus="() => emit('toggle-prometheus')"
      @arm-clear="() => emit('arm-clear')"
      @cancel-clear="() => emit('cancel-clear')"
      @clear-database="() => emit('clear-database')"
    />
  </section>
</template>

<style scoped>
/* ─── First-run empty-state hero ──────────────────────────── */

/* Tactical "ops briefing" card. Sits between the intro header and
   section 01 only while screenshotsDir is unset. Gives the empty
   state a primary CTA right where the eye lands — answers the
   heading directly instead of being buried in a row below. */
.empty-hero {
  position: relative;
  margin-top: 1rem;
  margin-bottom: 2.4rem;
  padding: 1.6rem 1.8rem 1.5rem;
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: 2px;
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--accent) 14%, transparent),
    0 8px 36px -16px var(--accent-glow);
  overflow: hidden;
}

.empty-hero::before {
  /* Diagonal hazard-stripe band on the left edge — the same idiom
     as System Alert but in accent colors. Reads as "active task". */
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 5px;
  background: repeating-linear-gradient(
    135deg,
    var(--accent) 0 6px,
    transparent 6px 12px
  );
  opacity: 0.7;
}

/* Four corner brackets (top-left, top-right, bottom-left, bottom-right).
   Pure decorative — registration marks like you'd see at the corners
   of a printed alignment target. */
.empty-hero-marker {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.empty-hero-corner {
  position: absolute;
  width: 14px;
  height: 14px;
  border: 1px solid var(--accent);
  opacity: 0.55;
}
.empty-hero-corner-tl { top: 8px;    left: 12px;  border-right: 0; border-bottom: 0; }
.empty-hero-corner-tr { top: 8px;    right: 12px; border-left: 0;  border-bottom: 0; }
.empty-hero-corner-bl { bottom: 8px; left: 12px;  border-right: 0; border-top: 0; }
.empty-hero-corner-br { bottom: 8px; right: 12px; border-left: 0;  border-top: 0; }

.empty-hero-eyebrow {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--accent);
  margin: 0 0 0.55rem;
}

.empty-hero-title {
  font-family: var(--display);
  font-weight: 800;
  font-size: 1.65rem;
  letter-spacing: -0.005em;
  line-height: 1.05;
  color: var(--text);
  text-transform: uppercase;
  margin: 0 0 0.55rem;
}

.empty-hero-desc {
  font-size: 0.86rem;
  color: var(--text-dim);
  line-height: 1.55;
  max-width: 62ch;
  margin: 0 0 1.15rem;
}

.empty-hero-desc code {
  font-family: var(--mono);
  font-size: 0.78rem;
  background: var(--surface-3);
  padding: 0.05rem 0.35rem;
  border-radius: 2px;
  color: var(--accent-text);
}

.empty-hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-bottom: 0.4rem;
}

.btn-icon {
  width: 14px;
  height: 14px;
  display: block;
}

/* ─── Dismissible probe-result chip ───────────────────────── */

/* `.probe-chip*`, `.probe-tried*`, and `.setting-help*` rules
   moved to `frontend/src/styles/app.css` because they're
   referenced by multiple SFCs (this view's empty-hero, plus the
   extracted SettingsFolders / SettingsEngine / SettingsAppearance
   / SettingsCalendar / SettingsBackupRestore / SettingsAdvanced
   panels) and Vue scoped styles don't cascade across components.
   See the comment in app.css for the regression context. */

/* ─── Sub-heading text in Settings sections ──────────────── */

.settings-sub {
  margin-top: 0.85rem;
  color: var(--text-dim);
  font-size: 0.875rem;
  line-height: 1.55;
  max-width: 60ch;
}

.settings-sub .empty-link {
  cursor: pointer;
}

/* `.setting-value` moved to app.css — used by SettingsFolders.vue's
   path display and SettingsEngine.vue's binary path, so a scoped
   block here wouldn't reach either child component (same
   data-v-hash mismatch that broke the Settings tooltip earlier). */

/* `.data-loc-*`, `.btn-copied`, `.folder-btn-group`, `.detect-btn`
   are single-consumer (SettingsFolders.vue only) and were moved
   into that SFC's own \3c style scoped> block. Theme-swatch +
   weekstart styles live with their respective Settings* panels. */

/* ─── Tactical-frame motif on settings-section ────────────── */

/* Tiny accent registration marks at the bottom-left of each
   settings-section block. The orange tick at the right of the
   section-header lives in app.css; this complements it at the
   opposite corner without re-stating the section divider. Empty
   gutters now carry brand presence rather than feeling sparse. */
.settings-section {
  position: relative;
}

.settings-section::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: -10px;
  width: 6px;
  height: 6px;
  background: var(--brand-gray);
  transform: rotate(45deg);
  opacity: 0.5;
  transition: background 200ms ease, box-shadow 200ms ease;
}

.settings-section:hover::after {
  background: var(--accent);
  box-shadow: 0 0 10px var(--accent-glow);
}

/* Light-mode override for the diamond corner lives in app.css under
   `#panel-settings .settings-section::after` so it stays a proper
   global rule. Vue's scoped CSS compiler miscompiles the
   `:global(...) .x::pseudo` pattern into a bare `[data-theme="light"]`
   rule on <html>, which would set opacity: 0.4 globally and wash
   the entire app once SettingsView mounted. */

/* `.engine-*`, `.warn-icon`, `.link-btn` styles moved to
   SettingsEngine.vue's \3c style scoped> block. */

/* `.export-btn-group` styles moved to SettingsBackupRestore.vue.
   `.setting-row.danger-row` + `.clear-confirm-group` stay here
   because they're shared with the Advanced section's Clear DB
   confirm flow. */

/* Armed-import + armed-clear rows share the same destructive bar. */
.setting-row.danger-row {
  padding-left: calc(1.4rem - 3px);
  background: var(--loss-soft);
  border-left: 3px solid var(--loss-line);
  border-radius: 2px;
  transition: background 200ms ease, border-color 200ms ease;
}

/* Light-mode override for .setting-row.danger-row lives in app.css. */

.clear-confirm-group {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.5rem;
}

/* Status meta strip shared between blocked + success states.
   The block-mark glyph carries the semantic colour so a colour-
   blind reader still gets the win/loss cue from the leading char. */
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

.setting-meta.blocked { color: var(--loss); }
.setting-meta.success { color: var(--win); }

.block-mark {
  margin-right: 0.15rem;
  font-size: 0.85rem;
  filter: saturate(0.85);
}

/* `.advanced-*` + `.big-switch*` styles moved to
   SettingsAdvanced.vue's \3c style scoped> block. */

/* ─── Reduced-motion override ─────────────────────────────── */

/* Reduced-motion for moved classes (.setting-help, .probe-chip-close,
   .theme-swatch, .weekstart-cell, .advanced-*, .big-switch*,
   .engine-row) lives where the corresponding rule lives — in
   app.css for the shared widgets, in each child SFC's scoped
   block for the panel-specific ones. Anything that's still
   defined inside this scoped block stays here. */
@media (prefers-reduced-motion: reduce) {
  .settings-section::after,
  .btn,
  .empty-hero {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
</style>
