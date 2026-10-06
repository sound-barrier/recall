<script setup lang="ts">
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '@/stores/app'
import { useParseStore } from '@/stores/parse'
import { useSettingsStore } from '@/stores/settings'
import ProbeChip from '@/components/settings/ProbeChip.vue'
import SettingsSections from '@/components/settings/SettingsSections.vue'
import ScreenshotSourcePicker from '@/components/settings/ScreenshotSourcePicker.vue'

// SettingsView — every knob a user might want to touch, sorted by
// frequency of first-time use:
//   01 Folders          — Screenshots Folder + Data Location
//   02 Engine           — Tesseract Binary (one-time setup)
//   03 Appearance       — Day/Night swatches
//   04 Calendar         — First Day of Week
//   05 Profiles         — Delete non-active profiles
//   06 Backup & Restore — Export JSON/CSV + Import Backup
//   07 Advanced         — Manage ignored screenshots + Re-parse All
//                          + Clear Database (collapsed behind a
//                          <details> by default)
//
// Engine, Backup & Restore, and Advanced used to live on the Ingest
// tab — moved here so casual users see a single config destination
// and the Ingest tab can focus on one job: "run a parse." The Wails
// runtime alert banner still deep-links to `#sec-engine` to fix a
// missing Tesseract.
//
// Reads everything from the stores: folders/engine/appearance/calendar + the
// source picker from settings, export/import/clear/reparse/ignored from matches,
// dataLocation + nav from app. The sub-section components keep their own prop
// contracts — this view binds them from the store values.
// The seven configuration sections live in SettingsSections (shared with the
// Settings dialog). This view adds the intro hero + the first-run "point Recall
// at your screenshots" CTA around them, so it only reads the state those need.
const appStore = useAppStore()
const settingsStore = useSettingsStore()
const { goToView } = appStore
const {
  screenshotsDir,
  probing,
  probeMessage,
  probeStatus,
  probeTried,
  tesseractStatus,
  screenshotCandidates,
} = storeToRefs(settingsStore)
const { pickDir, pickDetectedSource } = settingsStore
const { parseBusy } = storeToRefs(useParseStore())
const platform = computed(() => tesseractStatus.value?.platform ?? '')

// Probe-chip dismissal — local-only transient UI noise. Reset whenever a fresh
// probeMessage lands so a second Detect click re-opens the chip.
const probeDismissed = ref(false)

</script>

<template>
  <section id="panel-settings" role="tabpanel" aria-labelledby="tab-settings" tabindex="-1" class="settings">
    <header class="settings-intro">
      <p class="eyebrow settings-eyebrow">
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
        <button type="button" class="empty-link" @click="goToView('ingest')">
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
      <p class="eyebrow accent empty-hero-eyebrow">
        First-Time Setup
      </p>
      <h3 class="empty-hero-title">
        Point Recall at your Overwatch screenshots.
      </h3>
      <p class="empty-hero-desc">
        Recall can auto-detect the default capture folders on Windows — Nvidia Overlay, OW's PrntScn default, the Win Snip tool, and Steam — or you can point it at a custom directory. The folder gets watched for new <code>.png</code> files and parsed on save.
      </p>
      <ScreenshotSourcePicker
        :platform="platform ?? ''"
        :candidates="screenshotCandidates ?? []"
        :picking="parseBusy || probing"
        @pick="(_name: string, path: string) => pickDetectedSource(path)"
        @pick-custom="pickDir"
      />
      <ProbeChip
        v-model:dismissed="probeDismissed"
        :message="probeMessage"
        :status="probeStatus"
        dismiss-label="Dismiss detection result"
      />
      <details v-if="probeStatus === 'blocked' && !probeDismissed && (probeTried?.length ?? 0) > 0" class="probe-tried">
        <summary>Looked in</summary>
        <ol class="probe-tried-list">
          <li v-for="(p, i) in (probeTried ?? [])" :key="i" class="mono">
            {{ p }}
          </li>
        </ol>
      </details>
    </div>

    <SettingsSections />
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
  margin-top: var(--space-4);
  margin-bottom: var(--space-10);
  padding: var(--space-6) var(--space-7) var(--space-6);
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: var(--radius);
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
  margin: 0 0 var(--space-2);
}

.empty-hero-title {
  font-family: var(--display);
  font-weight: 800;
  font-size: var(--type-7xl);
  letter-spacing: -0.005em;
  line-height: 1.05;
  color: var(--text);
  text-transform: uppercase;
  margin: 0 0 var(--space-2);
}

.empty-hero-desc {
  font-size: var(--type-lg);
  color: var(--text-dim);
  line-height: 1.55;
  max-width: 62ch;
  margin: 0 0 var(--space-5);
}

.empty-hero-desc code {
  font-family: var(--mono);
  font-size: var(--type-md);
  background: var(--surface-3);
  padding: var(--space-0-5) var(--space-1);
  border-radius: var(--radius);
  color: var(--accent-text);
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
  margin-top: var(--space-3);
  color: var(--text-dim);
  font-size: var(--type-lg);
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

/* The `.settings-section` tactical-frame motif (registration diamond +
   inter-section hairlines) moved to SettingsSections.vue — it targets the
   section components' roots, which now render there (shared with the Settings
   dialog). */

/* Light-mode override for the diamond corner lives in app.css under
   `#panel-settings .settings-section::after` so it stays a proper
   global rule. Vue's scoped CSS compiler miscompiles the
   `:global(...) .x::pseudo` pattern into a bare `[data-theme="light"]`
   rule on <html>, which would set opacity: 0.4 globally and wash
   the entire app once SettingsView mounted. */

/* `.engine-*`, `.warn-icon`, `.link-btn` styles moved to
   SettingsEngine.vue's \3c style scoped> block. */

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
  .btn,
  .empty-hero {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
</style>
