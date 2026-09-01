<script setup lang="ts">
import SettingsAdvanced from '@/components/settings/SettingsAdvanced.vue'
import SettingsAppearance from '@/components/settings/SettingsAppearance.vue'
import SettingsBackupRestore from '@/components/settings/SettingsBackupRestore.vue'
import SettingsCalendar from '@/components/settings/SettingsCalendar.vue'
import SettingsCoach from '@/components/settings/SettingsCoach.vue'
import SettingsEngine from '@/components/settings/SettingsEngine.vue'
import SettingsFolders from '@/components/settings/SettingsFolders.vue'
import SettingsProfiles from '@/components/settings/SettingsProfiles.vue'
import SettingsRoster from '@/components/settings/SettingsRoster.vue'
import SettingsWindow from '@/components/settings/SettingsWindow.vue'

// The ten configuration sections, in order. Extracted from SettingsView so the
// same blocks back both the Settings tab and the Settings dialog without
// duplicating the wiring — the tab adds the intro hero + first-run CTA around
// this; the dialog frames it in a modal.
//
// Composition only. This used to be 90 lines of store-to-props shim over the
// six sections that took props, while the three beside them already took none
// — one file demonstrating both the target and the miss
// (TECHNICAL_DEBT.md section 15). Every section reads the stores it renders
// now, so the order below is the only thing left to state.
</script>

<template>
  <SettingsFolders />
  <SettingsEngine />
  <SettingsAppearance />
  <SettingsCalendar />
  <SettingsProfiles />
  <SettingsBackupRestore />
  <SettingsWindow />
  <SettingsCoach />
  <SettingsRoster />
  <SettingsAdvanced />
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
  border-top: 1px solid var(--border-soft);
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
  transition: background var(--duration-med) ease, box-shadow var(--duration-med) ease;
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
