<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settings'
import { isMacOS } from '@/platform'

// Window-close behavior (section 07) — desktop, Windows/Linux only. macOS always
// keeps the app in the menu bar per the platform convention (⌘Q quits), so the
// whole section is hidden there. Reads the store directly, like SettingsProfiles.
const settingsStore = useSettingsStore()
const { exitOnClose } = storeToRefs(settingsStore)
const { toggleExitOnClose } = settingsStore

// navigator.userAgent is fixed for the session, so a one-time read is fine.
const isMac = isMacOS()
</script>

<template>
  <section v-if="!isMac" id="sec-window" class="settings-section">
    <div class="section-header">
      <span class="section-num">07</span>
      <span class="section-slash" aria-hidden="true">/</span>
      <h3 class="section-title">
        Window
      </h3>
    </div>
    <div class="setting-rows">
      <div class="setting-row">
        <div class="setting-info">
          <h4 class="setting-label">
            When you close the window
          </h4>
          <p class="setting-desc">
            By default Recall hides to the system tray so it keeps watching your
            screenshots folder in the background. Turn this on to
            <strong>quit Recall</strong> on close instead — note that
            auto-parsing then stops until you reopen the app.
          </p>
        </div>
        <div class="setting-control">
          <label class="big-switch" :class="{ on: exitOnClose }">
            <input
              type="checkbox"
              :checked="exitOnClose"
              data-testid="exit-on-close-toggle"
              aria-label="Quit Recall when the window closes"
              @change="toggleExitOnClose()"
            >
            <span class="big-switch-track"><span class="big-switch-knob" /></span>
            <span class="big-switch-state">{{ exitOnClose ? 'Quit' : 'Tray' }}</span>
          </label>
        </div>
      </div>
    </div>
  </section>
</template>
