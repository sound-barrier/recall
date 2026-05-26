<script setup lang="ts">
import { ref } from 'vue'
import type { ThemeMode } from '../composables/useTheme'
import type { WeekStart } from '../composables/useWeekStart'
import type { DataLocation } from '../api'
import { WEEKDAYS_FULL } from '../match-helpers'

// SettingsView — Directories + Appearance + Calendar. Engine /
// Prometheus / Watch-folder knobs live in the Ingest view because
// they're tied to the parse workflow. Pulled out of App.vue so the
// panel can be unit-tested without mounting the entire ~4500-line shell.

defineProps<{
  screenshotsDir: string
  loading:        boolean
  themeMode:      ThemeMode
  weekStart:      WeekStart
  // Nullable + optional: App.vue's load() is async, so the row's
  // paths render `null` for a beat at mount time. Existing tests
  // that don't care can omit this prop entirely.
  dataLocation?:  DataLocation | null
}>()

const emit = defineEmits<{
  'pick-screenshots-dir': []
  'toggle-theme':         []
  'set-week-start':       [next: WeekStart]
  'go-to-view':           [next: 'settings' | 'ingest' | 'matches' | 'unknown']
}>()

// "Copied" pill state for the Data Location row. Set true when the
// user clicks Copy; cleared after 1.4 s so the pill flashes briefly
// without sticking on screen.
const copied = ref(false)
async function copyDbPath(path: string) {
  if (!path) return
  try {
    await navigator.clipboard.writeText(path)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1400)
  } catch (_) {
    // Clipboard API can fail in some sandboxed contexts; surface the
    // path via prompt() so the user can copy manually.
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

    <div id="sec-directories" class="settings-section">
      <div class="section-header">
        <span class="section-num">01</span>
        <span class="section-slash" aria-hidden="true">/</span>
        <h3 class="section-title">
          Directories
        </h3>
      </div>
      <div class="setting-rows">
        <div class="setting-row">
          <div class="setting-info">
            <h4 class="setting-label">
              Screenshots Folder
            </h4>
            <p class="setting-desc">
              Where Recall watches for new Overwatch screenshots. Click <strong>Change Folder</strong> to point it at a different directory.
            </p>
          </div>
          <div class="setting-control">
            <span class="setting-value mono" :title="screenshotsDir">{{ screenshotsDir || '— Not selected —' }}</span>
            <button class="btn ghost" :disabled="loading" @click="emit('pick-screenshots-dir')">
              Change Folder…
            </button>
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <h4 class="setting-label">
              Data Location
            </h4>
            <p class="setting-desc">
              Where Recall stores your parsed matches and settings on this machine. Read-only — Recall manages the contents but you can browse the directory at the OS level if you ever need to back it up manually.
            </p>
            <p v-if="dataLocation?.base_dir" class="data-loc-grid" :aria-label="'Recall data paths'">
              <span class="data-loc-key">Database</span>
              <span class="data-loc-val mono" :title="dataLocation.database_path">{{ dataLocation.database_path }}</span>
              <span class="data-loc-key">Settings</span>
              <span class="data-loc-val mono" :title="dataLocation.settings_path">{{ dataLocation.settings_path }}</span>
            </p>
          </div>
          <div class="setting-control">
            <button
              class="btn ghost"
              :disabled="!dataLocation?.database_path"
              :class="{ 'btn-copied': copied }"
              @click="copyDbPath(dataLocation?.database_path ?? '')"
            >
              <span v-if="copied">Copied ✓</span>
              <span v-else>Copy DB Path</span>
            </button>
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
        <div class="setting-row">
          <div class="setting-info">
            <h4 class="setting-label">
              Theme
            </h4>
            <p class="setting-desc">
              Switch between Day and Night palettes. Preference is remembered across launches.
            </p>
          </div>
          <div class="setting-control">
            <button
              class="theme-toggle"
              :title="themeMode === 'dark' ? 'Switch to Day' : 'Switch to Night'"
              :aria-label="themeMode === 'dark' ? 'Switch to Day' : 'Switch to Night'"
              @click="emit('toggle-theme')"
            >
              <span class="theme-seg" :class="{ active: themeMode === 'light' }">
                <svg viewBox="0 0 24 24" class="theme-icon" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" fill="currentColor" />
                  <g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
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
                <span class="theme-label">Day</span>
              </span>
              <span class="theme-divider" aria-hidden="true" />
              <span class="theme-seg" :class="{ active: themeMode === 'dark' }">
                <svg viewBox="0 0 24 24" class="theme-icon" aria-hidden="true">
                  <path d="M21 12.8A8.5 8.5 0 0 1 11.2 3a7 7 0 1 0 9.8 9.8z" fill="currentColor" />
                </svg>
                <span class="theme-label">Night</span>
              </span>
            </button>
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
            </h4>
            <p class="setting-desc">
              Anchors the <em>Week of</em> headers on the Matches page.
            </p>
          </div>
          <div class="setting-control">
            <div
              class="weekstart-row"
              role="radiogroup"
              aria-label="First day of week"
            >
              <template v-for="(seg, i) in DAY_SEGMENTS" :key="seg.idx">
                <button
                  type="button"
                  class="weekstart-seg"
                  role="radio"
                  :aria-checked="weekStart === seg.idx"
                  :class="{ active: weekStart === seg.idx }"
                  :title="`Weeks begin on ${seg.name}`"
                  @click="emit('set-week-start', seg.idx)"
                >
                  <span class="weekstart-letter" aria-hidden="true">{{ seg.letter }}</span>
                  <span class="weekstart-name">{{ seg.name }}</span>
                </button>
                <span v-if="i < DAY_SEGMENTS.length - 1" class="weekstart-divider" aria-hidden="true" />
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* ─── Day / Night theme toggle ───────────────────────────── */

/* Day / Night theme toggle. Two-segment switch with a sliding indicator
   on the active half. Lives in the Settings → Appearance row. */
.theme-toggle {
  position: relative;
  display: inline-flex;
  align-items: stretch;
  padding: 3px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  cursor: pointer;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
  user-select: none;
  transition: border-color 160ms ease, background 160ms ease;
}
.theme-toggle:hover { border-color: var(--border-strong); }

.theme-toggle:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.theme-seg {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.34rem 0.65rem;
  border-radius: 1px;
  transition: color 200ms ease, background 200ms ease;
}

.theme-seg.active {
  color: var(--accent);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}

.theme-icon {
  width: 13px; height: 13px;
  display: block;
}
.theme-label { font-weight: 600; }

.theme-divider {
  width: 1px;
  background: var(--border);
  margin: 4px 0;
}

:global([data-theme="light"]) .theme-toggle { background: var(--surface); }

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

/* ─── Data Location row — labeled key/value grid ─────────── */

/* Two-column grid: small uppercase key on the left, monospaced path
   on the right, repeated for each captured path. Tighter than a
   bulleted list and reads like a HUD readout. */
.data-loc-grid {
  margin-top: 0.65rem;
  display: grid;
  grid-template-columns: 6.4em 1fr;
  gap: 0.25rem 0.85rem;
  padding: 0.55rem 0.7rem;
  background: var(--surface);
  border-left: 1px solid var(--border-soft);
  font-size: 0.78rem;
  line-height: 1.45;
}

.data-loc-key {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
  align-self: baseline;
}

.data-loc-val {
  color: var(--text-dim);
  word-break: break-all;
}

/* "Copied ✓" pulse on the Copy DB Path button — accent flash for
   1.4 s after click, then settles back. */
.btn-copied {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}

/* 7-segment first-day-of-week picker. Same visual idiom as the theme
   toggle (segmented control, dim border, accent-tinted active state)
   stretched across all seven days so any culture's week-anchor works.
   Each segment stacks the big initial letter on top (iconography to
   scan a column at speed) and the full day name on the bottom (the
   authoritative label that resolves the two-T / two-S ambiguity). */

.weekstart-row {
  display: inline-flex;
  align-items: stretch;
  padding: 3px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  font-family: var(--mono);
  letter-spacing: 0.04em;
  text-transform: lowercase;
  color: var(--text-faint);
  user-select: none;
  transition: border-color 160ms ease, background 160ms ease;
}

.weekstart-row:hover { border-color: var(--border-strong); }

.weekstart-row:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.weekstart-seg {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.18rem;
  padding: 0.4rem 0.65rem;
  min-width: 4.4rem;
  background: transparent;
  border: 0;
  border-radius: 1px;
  cursor: pointer;
  color: inherit;
  font: inherit;
  transition: color 200ms ease, background 200ms ease, box-shadow 200ms ease;
}

.weekstart-seg:hover { color: var(--text); }

.weekstart-seg.active {
  color: var(--accent);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}

.weekstart-letter {
  font-family: var(--brand, 'OW Wordmark', 'Russo One', sans-serif);
  font-size: 1.05rem;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0;
}

.weekstart-name {
  font-size: 0.6rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  line-height: 1;
}

.weekstart-divider {
  width: 1px;
  background: var(--border);
  margin: 4px 0;
}
</style>
