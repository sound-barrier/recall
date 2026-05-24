<script setup lang="ts">
import type { ThemeMode } from '../composables/useTheme'
import type { WeekStart } from '../composables/useWeekStart'

// SettingsView — Directories + Appearance + Calendar. Engine /
// Prometheus / Watch-folder knobs live in the Ingest view because
// they're tied to the parse workflow. Pulled out of App.vue so the
// panel can be unit-tested without mounting the entire 4000-line shell.

defineProps<{
  screenshotsDir: string
  loading:        boolean
  themeMode:      ThemeMode
  weekStart:      WeekStart
}>()

const emit = defineEmits<{
  'pick-screenshots-dir': []
  'toggle-theme':         []
  'set-week-start':       [next: WeekStart]
  'go-to-view':           [next: 'settings' | 'ingest' | 'matches' | 'unknown']
}>()
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
        <strong class="empty-link" @click="emit('go-to-view', 'ingest')">Ingest →</strong>.
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
              Anchors the <em>Week of</em> headers on the Matches page. US default is Sunday; switch to Monday for ISO-8601 weeks.
            </p>
          </div>
          <div class="setting-control">
            <div
              class="theme-toggle weekstart-toggle"
              role="radiogroup"
              aria-label="First day of week"
            >
              <button
                type="button"
                class="theme-seg weekstart-seg"
                role="radio"
                :aria-checked="weekStart === 'sunday'"
                :class="{ active: weekStart === 'sunday' }"
                title="Weeks run Sunday → Saturday"
                @click="emit('set-week-start', 'sunday')"
              >
                <span class="weekstart-letter" aria-hidden="true">S</span>
                <span class="theme-label">Sun</span>
              </button>
              <span class="theme-divider" aria-hidden="true" />
              <button
                type="button"
                class="theme-seg weekstart-seg"
                role="radio"
                :aria-checked="weekStart === 'monday'"
                :class="{ active: weekStart === 'monday' }"
                title="Weeks run Monday → Sunday (ISO-8601)"
                @click="emit('set-week-start', 'monday')"
              >
                <span class="weekstart-letter" aria-hidden="true">M</span>
                <span class="theme-label">Mon</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* The weekstart toggle reuses the existing .theme-toggle / .theme-seg
   styling from App.vue's global stylesheet (segmented control, divider,
   active state). We just swap the icon-glyph slot for a typographic
   letter so Sun/Mon read at a glance without leaning on iconography
   that doesn't exist for "day of week". The letter sits where the
   theme icon sits, sized to match. */

.weekstart-toggle {
  /* Inherit segmented-control geometry from .theme-toggle. */
}

.weekstart-letter {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1em;
  height: 1em;
  font-family: var(--brand, 'OW Wordmark', 'Russo One', sans-serif);
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1;
  /* Sit slightly low so the optical center matches the theme icons. */
  transform: translateY(-1px);
}

.weekstart-seg {
  cursor: pointer;
  background: transparent;
  border: 0;
  color: inherit;
  font: inherit;
  padding: 0;
}
</style>
