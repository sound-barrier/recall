<script setup lang="ts">
import type { ThemeMode } from '../composables/useTheme'

// SettingsView — Directories + Appearance only. Engine / Prometheus /
// Watch-folder knobs live in the Ingest view because they're tied to
// the parse workflow. Pulled out of App.vue so the panel can be unit-
// tested without mounting the entire 4000-line shell.

defineProps<{
  screenshotsDir: string
  loading:        boolean
  themeMode:      ThemeMode
}>()

const emit = defineEmits<{
  'pick-screenshots-dir': []
  'toggle-theme':         []
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
  </section>
</template>
