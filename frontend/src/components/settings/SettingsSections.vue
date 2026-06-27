<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useSettingsStore } from '@/stores/settings'
import SettingsAdvanced from '@/components/settings/SettingsAdvanced.vue'
import SettingsAppearance from '@/components/settings/SettingsAppearance.vue'
import SettingsBackupRestore from '@/components/settings/SettingsBackupRestore.vue'
import SettingsCalendar from '@/components/settings/SettingsCalendar.vue'
import SettingsEngine from '@/components/settings/SettingsEngine.vue'
import SettingsFolders from '@/components/settings/SettingsFolders.vue'
import SettingsProfiles from '@/components/settings/SettingsProfiles.vue'

// The seven configuration sections (Folders → Advanced), bound from the stores.
// Extracted from SettingsView so the same blocks back both the Settings tab and
// the Settings dialog (SettingsModal) without duplicating the wiring — the tab
// adds the intro hero + first-run CTA around this; the dialog frames it in a
// modal. Reads the stores directly, like every store-bound component.
const appStore = useAppStore()
const matchesStore = useMatchesStore()
const settingsStore = useSettingsStore()
const { goToView } = appStore
const { dataLocation } = storeToRefs(appStore)
const {
  screenshotsDir,
  watchEnabled,
  themeMode,
  weekStart,
  probing,
  probeMessage,
  probeStatus,
  probeTried,
  tesseractReady,
  tesseractSupported,
  tesseractStatus,
  tesseractPickerBusy,
  tesseractProbing,
  tesseractProbeMessage,
  tesseractProbeStatus,
  tesseractProbeTried,
} = storeToRefs(settingsStore)
const {
  pickDir,
  detectDir,
  revealDir,
  resetDir,
  setTheme,
  setWeekStart,
  pickTesseractBinary,
  resetTesseractPath,
  detectTesseractBinary,
} = settingsStore
const {
  parseBusy,
  backingUp,
  restoring,
  restoreArmed,
  importingMatches,
  backupStatus,
  clearConfirm,
  clearingDB,
  ignoredCount,
} = storeToRefs(matchesStore)
const {
  backup,
  armRestore,
  cancelRestore,
  restore,
  importMatches,
  armClear,
  cancelClear,
  onClearDatabase,
  openIgnoredPanel,
  onReParseAll,
} = matchesStore
const matchedCount = computed(() => matchesStore.records.length)
const unknownCount = computed(() => matchesStore.unknownRecords.length)
const reparsing = parseBusy
</script>

<template>
  <SettingsFolders
    :screenshots-dir="screenshotsDir"
    :watch-enabled="watchEnabled"
    :parse-busy="parseBusy"
    :data-location="dataLocation"
    :probing="probing"
    :probe-message="probeMessage"
    :probe-status="probeStatus"
    :probe-tried="probeTried"
    @pick-screenshots-dir="pickDir"
    @detect-screenshots-dir="detectDir"
    @reveal-screenshots-dir="revealDir"
    @reset-screenshots-dir="resetDir"
  />

  <SettingsEngine
    :tesseract-ready="tesseractReady"
    :tesseract-supported="tesseractSupported"
    :tesseract-status="tesseractStatus"
    :tesseract-picker-busy="tesseractPickerBusy"
    :tesseract-probing="tesseractProbing"
    :tesseract-probe-message="tesseractProbeMessage"
    :tesseract-probe-status="tesseractProbeStatus"
    :tesseract-probe-tried="tesseractProbeTried"
    @pick-tesseract="pickTesseractBinary"
    @reset-tesseract="resetTesseractPath"
    @detect-tesseract="detectTesseractBinary"
  />

  <SettingsAppearance
    :theme-mode="themeMode"
    @set-theme="setTheme"
  />

  <SettingsCalendar
    :week-start="weekStart"
    @set-week-start="setWeekStart"
    @go-to-view="goToView"
  />

  <SettingsProfiles />

  <SettingsBackupRestore
    :backing-up="backingUp"
    :restoring="restoring"
    :restore-armed="restoreArmed"
    :importing-matches="importingMatches"
    :status="backupStatus"
    :matched-count="matchedCount"
    :unknown-count="unknownCount"
    @backup="backup"
    @arm-restore="armRestore"
    @restore="restore"
    @cancel-restore="cancelRestore"
    @import-matches="importMatches"
  />

  <SettingsAdvanced
    :clearing-d-b="clearingDB"
    :clear-confirm="clearConfirm"
    :matched-count="matchedCount"
    :unknown-count="unknownCount"
    :ignored-count="ignoredCount"
    :reparsing="reparsing"
    @arm-clear="armClear"
    @cancel-clear="cancelClear"
    @clear-database="onClearDatabase"
    @open-ignored-panel="openIgnoredPanel"
    @re-parse-all="onReParseAll"
  />
</template>

<style scoped>
/* ─── Tactical-frame motif on each settings-section ───────────
   These rules target the section components' ROOT elements (each
   renders `<section class="settings-section">`), so they live with
   the component that renders those sections. A scoped rule reaches a
   child component's root but not deeper, which is exactly this case. */
.settings-section {
  position: relative;
}

/* 1px hairline above each section heading so the long Settings page
   chunks into clear bands. The first section's hairline is suppressed
   (adjacent-sibling combinator) so it doesn't double against the top. */
.settings-section + .settings-section {
  margin-top: 1.4rem;
  padding-top: 1.4rem;
  border-top: 1px solid var(--border-soft, var(--border));
}

/* Accent registration mark at the bottom-left of each section block. */
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

@media (prefers-reduced-motion: reduce) {
  .settings-section::after {
    transition-duration: 0.01ms !important;
  }
}
</style>
