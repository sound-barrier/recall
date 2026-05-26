<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { ThemeMode } from '../composables/useTheme'
import type { WeekStart } from '../composables/useWeekStart'
import type { DataLocation } from '../api'
import { OpenURL, IS_WAILS } from '../api'
import { WEEKDAYS_FULL } from '../match-helpers'

// SettingsView — Directories + Appearance + Calendar. Engine /
// Prometheus / Watch-folder knobs live in the Ingest view because
// they're tied to the parse workflow. Pulled out of App.vue so the
// panel can be unit-tested without mounting the entire ~4500-line shell.

const props = defineProps<{
  screenshotsDir: string
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
}>()

const emit = defineEmits<{
  'pick-screenshots-dir':   []
  'detect-screenshots-dir': []
  'toggle-theme':           []
  'set-week-start':         [next: WeekStart]
  'go-to-view':             [next: 'settings' | 'ingest' | 'matches' | 'unknown']
}>()

function onDetect() {
  emit('detect-screenshots-dir')
}

// Open the OS file manager at `path`. Wails routes file:// through
// BrowserOpenURL → Finder / Explorer / xdg-open. Browser/server
// mode can't reach the user's filesystem, so the affordance is
// hidden via `canOpenFolder` and this never fires there.
function openFolder(path: string) {
  if (!path) return
  // Wails normalises forward/back slashes, so we don't need to
  // hand-roll a Windows-vs-POSIX file URL.
  const url = path.startsWith('file://') ? path : 'file://' + path
  OpenURL(url)
}

const canOpenFolder = IS_WAILS

// Probe-chip dismissal — local-only transient UI noise. Reset
// whenever a fresh probeMessage lands so a second Detect click
// re-opens the chip without forcing the user to scroll for it.
const probeDismissed = ref(false)
watch(() => props.probeMessage, (next) => {
  if (next) probeDismissed.value = false
})
const showProbeChip = computed(() => !!props.probeMessage && !probeDismissed.value)

// Track which path was last copied so the per-path Copy button can
// flash "✓" on the right one. Empty string = nothing recently copied.
const copied = ref<'' | 'db' | 'settings'>('')
async function copyPath(path: string, which: 'db' | 'settings') {
  if (!path) return
  try {
    await navigator.clipboard.writeText(path)
    copied.value = which
    setTimeout(() => {
      if (copied.value === which) copied.value = ''
    }, 1400)
  } catch (_) {
    // Clipboard API can fail in some sandboxed contexts; surface
    // the path via prompt() so the user can copy manually.
    window.prompt('Copy this path:', path)
  }
}

// The seven first-day-of-week options. Order = JS Date.getDay() so
// the index IS the WeekStart value — no separate mapping needed.
// Letter is a visual marker for the segmented control (S/M/T/W/T/F/S);
// the full day name sits beneath each segment so ambiguity (two Ts,
// two Ss) is always resolved by the label, not by squinting.
const DAY_SEGMENTS = WEEKDAYS_FULL.map((name, idx) => ({
  idx: idx as WeekStart,
  letter: name.charAt(0),
  name,
}))

const activeWeekDayName = computed(() => WEEKDAYS_FULL[props.weekStart] ?? 'Sunday')
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
        OCR engine, parsing, exports, and data management live in
        <button type="button" class="empty-link" @click="emit('go-to-view', 'ingest')">
          Ingest →
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

    <div id="sec-directories" class="settings-section">
      <div class="section-header">
        <span class="section-num">01</span>
        <span class="section-slash" aria-hidden="true">/</span>
        <h3 class="section-title">
          Directories
        </h3>
      </div>
      <div class="setting-rows">
        <!-- The Screenshots Folder row only renders the steady-state
             view once a folder is set. First-run lives in the hero. -->
        <div v-if="screenshotsDir" class="setting-row screenshots-row">
          <div class="setting-info">
            <h4 class="setting-label">
              Screenshots Folder
              <span class="setting-help" tabindex="0" role="note">
                <span class="setting-help-mark" aria-hidden="true">?</span>
                <span class="setting-help-label">About Screenshots Folder</span>
                <span class="setting-help-pop" role="tooltip">
                  Recall watches this directory for new <code>.png</code> screenshots and parses them on save. Change it whenever your Overwatch install moves.
                </span>
              </span>
            </h4>
            <p class="setting-desc">
              Recall is watching this folder. <strong>Detect</strong> walks the default OW install locations again; <strong>Change…</strong> opens the system folder picker.
            </p>
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
          <div class="setting-control">
            <span class="setting-value mono" :title="screenshotsDir">{{ screenshotsDir }}</span>
            <div class="folder-btn-group">
              <button
                v-if="canOpenFolder"
                class="btn ghost tiny"
                :disabled="loading"
                :title="'Open ' + screenshotsDir + ' in file manager'"
                @click="openFolder(screenshotsDir)"
              >
                <svg viewBox="0 0 24 24" class="btn-icon" aria-hidden="true">
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                </svg>
                Open
              </button>
              <button
                class="btn ghost tiny detect-btn"
                :disabled="loading || probing"
                @click="onDetect"
              >
                <span v-if="probing">Detecting…</span>
                <span v-else>Detect</span>
              </button>
              <button class="btn ghost tiny" :disabled="loading" @click="emit('pick-screenshots-dir')">
                Change…
              </button>
            </div>
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <h4 class="setting-label">
              Data Location
              <span class="setting-help" tabindex="0" role="note">
                <span class="setting-help-mark" aria-hidden="true">?</span>
                <span class="setting-help-label">About Data Location</span>
                <span class="setting-help-pop" role="tooltip">
                  Read-only paths Recall manages. Back the directory up with any file-level tool if you want a manual snapshot — use Ingest → Export for a portable JSON / CSV bundle.
                </span>
              </span>
            </h4>
            <p class="setting-desc">
              Where Recall stores your parsed matches and settings on this machine. Recall manages the contents but you can browse the directory at the OS level if you ever need to back it up manually.
            </p>
            <div v-if="dataLocation?.base_dir" class="data-loc-grid" :aria-label="'Recall data paths'">
              <span class="data-loc-key">Database</span>
              <span class="data-loc-val mono" :title="dataLocation.database_path">{{ dataLocation.database_path }}</span>
              <div class="data-loc-actions">
                <button
                  class="btn ghost tiny"
                  :class="{ 'btn-copied': copied === 'db' }"
                  @click="copyPath(dataLocation.database_path, 'db')"
                >
                  <span v-if="copied === 'db'">Copied ✓</span>
                  <span v-else>Copy</span>
                </button>
                <button
                  v-if="canOpenFolder"
                  class="btn ghost tiny"
                  @click="openFolder(dataLocation.base_dir + '/db')"
                >
                  Open
                </button>
              </div>
              <span class="data-loc-key">Settings</span>
              <span class="data-loc-val mono" :title="dataLocation.settings_path">{{ dataLocation.settings_path }}</span>
              <div class="data-loc-actions">
                <button
                  class="btn ghost tiny"
                  :class="{ 'btn-copied': copied === 'settings' }"
                  @click="copyPath(dataLocation.settings_path, 'settings')"
                >
                  <span v-if="copied === 'settings'">Copied ✓</span>
                  <span v-else>Copy</span>
                </button>
                <button
                  v-if="canOpenFolder"
                  class="btn ghost tiny"
                  @click="openFolder(dataLocation.base_dir)"
                >
                  Open
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div id="sec-appearance" class="settings-section">
      <div class="section-header">
        <span class="section-num">02</span>
        <span class="section-slash" aria-hidden="true">/</span>
        <h3 class="section-title">
          Appearance
        </h3>
      </div>
      <div class="setting-rows">
        <div class="setting-row appearance-row">
          <div class="setting-info">
            <h4 class="setting-label">
              Theme
              <span class="setting-help" tabindex="0" role="note">
                <span class="setting-help-mark" aria-hidden="true">?</span>
                <span class="setting-help-label">About Theme</span>
                <span class="setting-help-pop" role="tooltip">
                  Day and Night share the same orange accent but invert surface/text values. Match the room you play in — Night for evenings, Day for sunlit screens.
                </span>
              </span>
            </h4>
            <p class="setting-desc">
              Switch between Day and Night palettes. Click a preview to apply; the choice persists across launches.
            </p>
          </div>
          <div class="setting-control">
            <div class="theme-swatch-row" role="radiogroup" aria-label="Theme">
              <button
                type="button"
                class="theme-swatch light-swatch"
                role="radio"
                :aria-checked="themeMode === 'light'"
                :class="{ active: themeMode === 'light' }"
                @click="themeMode === 'light' ? null : emit('toggle-theme')"
              >
                <div class="swatch-preview" aria-hidden="true">
                  <div class="swatch-mast" />
                  <div class="swatch-body">
                    <div class="swatch-line w-70" />
                    <div class="swatch-line w-45" />
                    <div class="swatch-line w-60" />
                    <div class="swatch-tick" />
                  </div>
                </div>
                <div class="swatch-label">
                  <svg viewBox="0 0 24 24" class="swatch-icon" aria-hidden="true">
                    <circle cx="12" cy="12" r="4" fill="currentColor" />
                    <g stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
                      <line x1="12" y1="2" x2="12" y2="5" />
                      <line x1="12" y1="19" x2="12" y2="22" />
                      <line x1="2" y1="12" x2="5" y2="12" />
                      <line x1="19" y1="12" x2="22" y2="12" />
                      <line x1="4.6" y1="4.6" x2="6.7" y2="6.7" />
                      <line x1="17.3" y1="17.3" x2="19.4" y2="19.4" />
                      <line x1="4.6" y1="19.4" x2="6.7" y2="17.3" />
                      <line x1="17.3" y1="6.7" x2="19.4" y2="4.6" />
                    </g>
                  </svg>
                  Day
                </div>
              </button>
              <button
                type="button"
                class="theme-swatch dark-swatch"
                role="radio"
                :aria-checked="themeMode === 'dark'"
                :class="{ active: themeMode === 'dark' }"
                @click="themeMode === 'dark' ? null : emit('toggle-theme')"
              >
                <div class="swatch-preview" aria-hidden="true">
                  <div class="swatch-mast" />
                  <div class="swatch-body">
                    <div class="swatch-line w-70" />
                    <div class="swatch-line w-45" />
                    <div class="swatch-line w-60" />
                    <div class="swatch-tick" />
                  </div>
                </div>
                <div class="swatch-label">
                  <svg viewBox="0 0 24 24" class="swatch-icon" aria-hidden="true">
                    <path d="M21 12.8A8.5 8.5 0 0 1 11.2 3a7 7 0 1 0 9.8 9.8z" fill="currentColor" />
                  </svg>
                  Night
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div id="sec-calendar" class="settings-section">
      <div class="section-header">
        <span class="section-num">03</span>
        <span class="section-slash" aria-hidden="true">/</span>
        <h3 class="section-title">
          Calendar
        </h3>
      </div>
      <div class="setting-rows">
        <div class="setting-row">
          <div class="setting-info">
            <h4 class="setting-label">
              First Day of Week
              <span class="setting-help" tabindex="0" role="note">
                <span class="setting-help-mark" aria-hidden="true">?</span>
                <span class="setting-help-label">About First Day of Week</span>
                <span class="setting-help-pop" role="tooltip">
                  Sets where weeks begin in date grouping. Sunday-anchored in the US/CA, Monday-anchored across most of Europe and ISO calendars.
                </span>
              </span>
            </h4>
            <p class="setting-desc">
              Anchors the
              <button type="button" class="empty-link" @click="emit('go-to-view', 'matches')">
                Week of
              </button>
              headers on the Matches page.
            </p>
          </div>
          <div class="setting-control weekstart-control">
            <div
              class="weekstart-grid"
              role="radiogroup"
              aria-label="First day of week"
            >
              <button
                v-for="seg in DAY_SEGMENTS"
                :key="seg.idx"
                type="button"
                class="weekstart-cell"
                role="radio"
                :aria-checked="weekStart === seg.idx"
                :class="{ active: weekStart === seg.idx }"
                :title="`Weeks begin on ${seg.name}`"
                @click="emit('set-week-start', seg.idx)"
              >
                <span class="weekstart-letter" aria-hidden="true">{{ seg.letter }}</span>
              </button>
            </div>
            <p class="weekstart-caption">
              Weeks begin on <strong>{{ activeWeekDayName }}</strong>.
            </p>
          </div>
        </div>
      </div>
    </div>
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

/* Two-state pill with a fat coloured bar on the left, a 1.05rem
   mark glyph, the body text, and a × dismiss. Reused both inside
   the empty-state hero and inside the steady-state Screenshots
   Folder row's left column. */
.probe-chip {
  position: relative;
  display: inline-flex;
  align-items: stretch;
  gap: 0;
  margin-top: 0.65rem;
  padding-right: 0.4rem;
  font-family: var(--mono);
  font-size: 0.74rem;
  letter-spacing: 0.02em;
  line-height: 1.4;
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 2px;
  color: var(--text-dim);
  max-width: 100%;
  overflow: hidden;
}

.probe-chip.success {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  color: var(--accent-text);
}

.probe-chip.blocked {
  border-color: var(--border-strong);
  background: var(--surface-2);
  color: var(--text);
}

.probe-chip-bar {
  flex: 0 0 4px;
  background: var(--border-strong);
}

.probe-chip.success .probe-chip-bar { background: var(--accent); }
.probe-chip.blocked .probe-chip-bar { background: var(--text-faint); }

.probe-chip-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 0.55rem 0 0.6rem;
  font-size: 1.05rem;
  font-weight: 700;
  line-height: 1;
}

.probe-chip.success .probe-chip-mark { color: var(--accent); }
.probe-chip.blocked .probe-chip-mark { color: var(--text); }

.probe-chip-text {
  display: inline-flex;
  align-items: center;
  padding: 0.42rem 0.6rem 0.42rem 0;
  word-break: break-all;
  flex: 1;
}

.probe-chip-close {
  appearance: none;
  border: 0;
  background: transparent;
  color: currentcolor;
  font-size: 1.05rem;
  line-height: 1;
  padding: 0 0.45rem;
  cursor: pointer;
  align-self: center;
  border-radius: 1px;
  transition: background 140ms ease;
}

.probe-chip-close:hover  { background: color-mix(in srgb, currentcolor 12%, transparent); }

.probe-chip-close:focus-visible {
  outline: none;
  background: color-mix(in srgb, currentcolor 18%, transparent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

/* ─── Probe "Looked in" disclosure ────────────────────────── */

/* Defaults closed so the row stays compact; the user opens it on
   demand for diagnostic context on a no-match. */
.probe-tried {
  margin-top: 0.45rem;
  font-size: 0.72rem;
  color: var(--text-faint);
}

.probe-tried > summary {
  cursor: pointer;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.probe-tried-list {
  margin: 0.35rem 0 0;
  padding-left: 1.3rem;
  font-size: 0.72rem;
  color: var(--text-dim);
  word-break: break-all;
}

.probe-tried-list li + li {
  margin-top: 0.2rem;
}

/* ─── Per-row help affordance ─────────────────────────────── */

/* Small "?" mark to the right of each setting label. Hovering or
   focussing it pops a tooltip with deeper context. Pure CSS — no
   JS popover. The hidden span carrying the accessible label keeps
   the icon screen-reader-meaningful even when the tooltip is
   hidden. */
.setting-help {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  width: 18px;
  height: 18px;
  margin-left: 0.45rem;
  border-radius: 50%;
  border: 1px solid var(--border);
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: 0.62rem;
  font-weight: 700;
  line-height: 1;
  cursor: help;
  transition: color 140ms ease, border-color 140ms ease, background 140ms ease;
  vertical-align: middle;
}

.setting-help:hover,
.setting-help:focus-visible {
  outline: none;
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}

.setting-help-mark { line-height: 1; }

.setting-help-label {
  /* Visible-to-screen-readers-only. */
  position: absolute;
  width: 1px; height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.setting-help-pop {
  position: absolute;
  top: calc(100% + 0.45rem);
  left: 50%;
  transform: translateX(-50%) translateY(-4px);
  width: 260px;
  padding: 0.6rem 0.75rem;
  background: var(--surface-3);
  border: 1px solid var(--accent);
  border-radius: 2px;
  font-family: var(--body);
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.45;
  letter-spacing: 0;
  text-transform: none;
  color: var(--text);
  opacity: 0;
  pointer-events: none;
  transition: opacity 140ms ease, transform 140ms ease;
  z-index: 5;
  box-shadow: 0 8px 24px -8px rgb(0 0 0 / 50%);
}

.setting-help-pop::before {
  /* Pointer triangle at the top of the popover, lined up with the ? icon. */
  content: '';
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: 0; height: 0;
  border: 5px solid transparent;
  border-bottom-color: var(--accent);
}

.setting-help-pop code {
  font-family: var(--mono);
  font-size: 0.72rem;
  background: var(--surface);
  padding: 0.05rem 0.3rem;
  border-radius: 2px;
  color: var(--accent-text);
}

.setting-help:hover .setting-help-pop,
.setting-help:focus-visible .setting-help-pop {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
  pointer-events: auto;
}

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

/* ─── Right-rail value chip in setting rows ──────────────── */

.setting-value {
  font-family: var(--mono);
  font-size: 0.78rem;
  color: var(--text-dim);
  letter-spacing: 0;
  text-align: right;
  word-break: break-all;
  max-width: 420px;
  padding: 0.35rem 0.7rem;
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 2px;
}

/* ─── Data Location row — labeled key/value grid with actions ─── */

/* Three-column grid: small uppercase key on the left, monospaced
   path in the middle, action buttons (Copy / Open) on the right.
   Reads like a HUD readout with affordances per row. */
.data-loc-grid {
  margin-top: 0.65rem;
  display: grid;
  grid-template-columns: 6.4em minmax(0, 1fr) auto;
  gap: 0.45rem 0.85rem;
  padding: 0.65rem 0.7rem;
  background: var(--surface);
  border-left: 2px solid var(--accent);
  font-size: 0.78rem;
  line-height: 1.45;
}

.data-loc-key {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
  align-self: center;
}

.data-loc-val {
  color: var(--text-dim);
  word-break: break-all;
  align-self: center;
}

.data-loc-actions {
  display: inline-flex;
  gap: 0.35rem;
  place-self: center end;
}

/* "Copied ✓" pulse on Copy buttons — accent flash for 1.4 s. */
.btn-copied {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}

/* ─── Screenshots Folder steady-state ─────────────────────── */

/* Two-button cluster: Open + Detect + Change. Stacks on narrow
   rails so the right edge of the row stays tidy. The Detect
   button gets a subtle accent border because it's the "smart"
   affordance — the OS folder picker is the boring fallback. */
.folder-btn-group {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.4rem;
}

.detect-btn {
  border-color: var(--accent);
  color: var(--accent);
}

.detect-btn:hover:not(:disabled) {
  background: var(--accent-soft);
  border-color: var(--accent);
}

/* ─── Theme swatch cards (replaces the old segmented toggle) ─── */

/* Two side-by-side preview cards showing a miniature of the
   theme's palette. Active card gets the accent ring + glow.
   Each card sets its own CSS variables inline (via the
   .light-swatch / .dark-swatch class) so both render their own
   palette regardless of the document's [data-theme]. */
.theme-swatch-row {
  display: inline-flex;
  gap: 0.7rem;
}

.theme-swatch {
  appearance: none;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.55rem;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 2px;
  cursor: pointer;
  text-align: left;
  transition: border-color 160ms ease, box-shadow 200ms ease, transform 140ms ease;
  font: inherit;
  color: var(--text-dim);
}

.theme-swatch:hover:not(.active)        { border-color: var(--border-strong); transform: translateY(-1px); }

.theme-swatch:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.theme-swatch.active {
  border-color: var(--accent);
  box-shadow:
    0 0 0 1px var(--accent),
    0 6px 24px -12px var(--accent-glow);
  color: var(--accent);
}

.swatch-preview {
  position: relative;
  width: 132px;
  height: 78px;
  border-radius: 1px;
  overflow: hidden;
  background: var(--swatch-bg);
  border: 1px solid var(--swatch-border);
}

.swatch-mast {
  height: 11px;
  background: var(--swatch-mast);
  border-bottom: 1px solid var(--swatch-border);
}

.swatch-body {
  position: relative;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.swatch-line {
  height: 5px;
  border-radius: 1px;
  background: var(--swatch-text);
  opacity: 0.7;
}
.swatch-line.w-70 { width: 70%; }
.swatch-line.w-45 { width: 45%; }
.swatch-line.w-60 { width: 60%; }

.swatch-tick {
  position: absolute;
  right: 9px;
  bottom: 8px;
  width: 14px;
  height: 3px;
  background: var(--swatch-accent);
  box-shadow: 0 0 8px var(--swatch-accent);
}

.swatch-label {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: var(--mono);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.swatch-icon {
  width: 13px;
  height: 13px;
  display: block;
}

/* Light-swatch palette (frozen — these match the live light theme
   surfaces in app.css; if the tokens there drift, refresh these). */
.light-swatch {
  --swatch-bg:     #faf6ee;
  --swatch-mast:   #ece6d6;
  --swatch-border: #d8d1bd;
  --swatch-text:   #2a2722;
  --swatch-accent: #c2410c;
}

/* Dark-swatch palette (frozen — matches the live dark theme). */
.dark-swatch {
  --swatch-bg:     #15161a;
  --swatch-mast:   #1d1f24;
  --swatch-border: #2a2d33;
  --swatch-text:   #d8d9de;
  --swatch-accent: #ff7a3a;
}

/* ─── First-day-of-week — compact 7-cell grid ────────────── */

/* Replaces the old ~490 px segmented row. Seven 36 px cells
   shoulder-to-shoulder, each carrying a single Big Noodle initial.
   Active cell is filled solid orange. A caption below resolves the
   "two T / two S" ambiguity without forcing labels into every cell. */
.weekstart-control {
  align-items: flex-end;
  gap: 0.5rem;
}

.weekstart-grid {
  display: inline-grid;
  grid-template-columns: repeat(7, 36px);
  gap: 2px;
  padding: 3px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  transition: border-color 160ms ease;
}

.weekstart-grid:hover         { border-color: var(--border-strong); }

.weekstart-grid:focus-within  {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.weekstart-cell {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 38px;
  background: transparent;
  border: 0;
  border-radius: 1px;
  color: var(--text-faint);
  cursor: pointer;
  transition: color 140ms ease, background 140ms ease, box-shadow 140ms ease, transform 140ms ease;
}

.weekstart-cell:hover         { color: var(--text); background: rgb(255 255 255 / 3%); }

.weekstart-cell.active {
  color: var(--accent);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}

.weekstart-letter {
  font-family: var(--brand, 'OW Wordmark', 'Russo One', sans-serif);
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0;
  transform: translateY(1px);
}

.weekstart-caption {
  margin: 0;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.weekstart-caption strong {
  color: var(--text);
  font-weight: 700;
}

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

/* Light-mode swap — the dark theme's CRT-glow look would clash. */
:global([data-theme="light"]) .settings-section::after {
  background: var(--accent-text);
  opacity: 0.4;
}

/* ─── Reduced-motion override ─────────────────────────────── */

@media (prefers-reduced-motion: reduce) {
  .theme-swatch,
  .theme-swatch:hover,
  .weekstart-cell,
  .setting-help,
  .setting-help-pop,
  .probe-chip-close,
  .settings-section::after,
  .btn,
  .empty-hero {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
</style>
