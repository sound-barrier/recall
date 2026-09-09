<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settings'
import { isMacOS, IS_WAILS } from '@/platform'

// Section 07 holds the two things that are about the window itself. Reads the
// store directly, like SettingsProfiles.
//
// The two rows are gated differently, which is why the guard is per-row rather
// than on the section: close behavior is a Windows/Linux idea (macOS always
// keeps the app in the menu bar per platform convention, where ⌘Q quits), while
// the size reset needs a native window at all — server mode is a browser tab
// with nothing to resize.
const settingsStore = useSettingsStore()
const { exitOnClose } = storeToRefs(settingsStore)
const { toggleExitOnClose, resetWindowSize } = settingsStore

// navigator.userAgent is fixed for the session, so a one-time read is fine.
const isMac = isMacOS()
const isDesktop = IS_WAILS
</script>

<template>
  <section v-if="!isMac || isDesktop" id="sec-window" class="settings-section">
    <div class="section-header">
      <span class="section-num">07</span>
      <span class="section-slash" aria-hidden="true">/</span>
      <h3 class="section-title">
        Window
      </h3>
    </div>
    <div class="setting-rows">
      <div v-if="!isMac" class="setting-row">
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
      <div v-if="isDesktop" class="setting-row">
        <div class="setting-info">
          <h4 class="setting-label">
            Window size
          </h4>
          <p class="setting-desc">
            Recall opens at the size and position you last left it, on the
            monitor you left it on. Reset returns it to a comfortable share of
            the current display, centered — useful if it has ended up somewhere
            awkward, or if you have changed monitors.
          </p>
        </div>
        <div class="setting-control">
          <button
            class="btn ghost tiny reset-btn"
            data-testid="reset-window-size"
            title="Return the window to its default size and position"
            @click="resetWindowSize()"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
