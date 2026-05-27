<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { DataLocation } from '../api'
import { OpenURL, IS_WAILS } from '../api'

// Folders panel (steady-state section 01) — Screenshots Folder row
// + Data Location read-only paths. The first-run empty-hero stays
// in SettingsView because it's a page-level affordance, not part of
// any one section.
//
// Extracted from SettingsView so the probe-chip / probe-dismissed
// transient state + the copy-path "✓" flash + the Wails-only Open
// folder button all live with the section that owns them.

const props = defineProps<{
  screenshotsDir: string
  loading: boolean
  dataLocation?:  DataLocation | null
  probing?:       boolean
  probeMessage?:  string
  probeStatus?:   '' | 'success' | 'blocked'
  probeTried?:    string[]
}>()

const emit = defineEmits<{
  'pick-screenshots-dir':   []
  'detect-screenshots-dir': []
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
</script>

<template>
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
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
