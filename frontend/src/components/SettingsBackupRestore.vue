<script setup lang="ts">
import type { ExportStatus } from '../composables/useBackupRestore'

// Backup & Restore panel — JSON / CSV export buttons + a two-step
// arm/confirm Import flow that replaces the live DB. Extracted from
// SettingsView so the state surface (5 props + 5 emits) and the
// inline status messaging stay scoped to one SFC.
//
// `.setting-row.danger-row` + `.clear-confirm-group` are used by
// both this panel AND the SettingsAdvanced Clear-DB row, so those
// styles stay in SettingsView (or its parent stylesheet). Only the
// truly Backup-specific `.export-btn-group` family lives here.

defineProps<{
  exporting?:    false | 'json' | 'csv'
  importing?:    boolean
  importArmed?:  boolean
  exportStatus?: ExportStatus | null
  matchedCount?: number
  unknownCount?: number
}>()

const emit = defineEmits<{
  'export-data':     []
  'export-data-csv': []
  'arm-import':      []
  'import-data':     []
  'cancel-import':   []
}>()
</script>

<template>
  <div id="sec-backup" class="settings-section">
    <div class="section-header">
      <span class="section-num">05</span>
      <span class="section-slash" aria-hidden="true">/</span>
      <h3 class="section-title">
        Backup &amp; Restore
      </h3>
    </div>
    <div class="setting-rows">
      <div class="setting-row">
        <div class="setting-info">
          <h4 class="setting-label">
            Export Data
            <span class="setting-help" tabindex="0" role="note">
              <span class="setting-help-mark" aria-hidden="true">?</span>
              <span class="setting-help-label">About Export</span>
              <span class="setting-help-pop" role="tooltip">
                Pick <strong>JSON</strong> for a portable single-file Recall backup. Pick <strong>CSV</strong> for a ZIP of per-table spreadsheets you can open in Excel / Sheets. Both round-trip through Import.
              </span>
            </span>
          </h4>
          <p class="setting-desc">
            Download a portable backup of every parsed match. <strong>JSON</strong> is the canonical Recall format (smallest, round-trips losslessly); <strong>CSV</strong> exports a ZIP archive of one CSV per table for Excel / Sheets. Settings + screenshots aren't included.
          </p>
          <p v-if="exportStatus && exportStatus.ok" class="setting-meta success">
            <span class="block-mark" aria-hidden="true">✓</span>
            {{ exportStatus.message }}
          </p>
          <p v-else-if="exportStatus && !exportStatus.ok" class="setting-meta blocked">
            <span class="block-mark" aria-hidden="true">✕</span>
            {{ exportStatus.message }}
          </p>
        </div>
        <div class="setting-control">
          <div class="export-btn-group">
            <button
              class="btn ghost"
              :disabled="!!exporting || importing"
              @click="emit('export-data')"
            >
              <span v-if="exporting === 'json'">Saving…</span>
              <span v-else>JSON</span>
            </button>
            <button
              class="btn ghost"
              :disabled="!!exporting || importing"
              @click="emit('export-data-csv')"
            >
              <span v-if="exporting === 'csv'">Saving…</span>
              <span v-else>CSV</span>
            </button>
          </div>
        </div>
      </div>

      <div class="setting-row" :class="{ 'danger-row': importArmed }">
        <div class="setting-info">
          <h4 class="setting-label">
            Import Data
            <span class="setting-help" tabindex="0" role="note">
              <span class="setting-help-mark" aria-hidden="true">?</span>
              <span class="setting-help-label">About Import</span>
              <span class="setting-help-pop" role="tooltip">
                Restores a previously-exported backup. <strong>Replaces</strong> the live database — local matches not in the backup are lost. Two-step arm/confirm prevents accidental wipes.
              </span>
            </span>
          </h4>
          <p class="setting-desc">
            Restore from a previously-exported JSON backup. <strong>Replaces</strong> everything currently in the database — local matches that aren't in the backup will be lost.
          </p>
          <p v-if="importArmed" class="setting-meta blocked">
            <span class="block-mark" aria-hidden="true">⚠</span>
            This wipes {{ (matchedCount ?? 0) + (unknownCount ?? 0) }} record{{ ((matchedCount ?? 0) + (unknownCount ?? 0)) === 1 ? '' : 's' }} before loading the backup.
          </p>
        </div>
        <div class="setting-control">
          <template v-if="!importArmed">
            <button
              class="btn danger-outline"
              :disabled="importing || !!exporting"
              @click="emit('arm-import')"
            >
              Import Backup…
            </button>
          </template>
          <template v-else>
            <div class="clear-confirm-group">
              <button
                class="btn danger"
                :disabled="importing"
                @click="emit('import-data')"
              >
                <span v-if="importing">Loading…</span>
                <span v-else>Choose File…</span>
              </button>
              <button class="btn ghost" :disabled="importing" @click="emit('cancel-import')">
                Cancel
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Side-by-side JSON | CSV format picker. Mono labels + tight gap
   so the pair reads as one choice rather than two actions. */
.export-btn-group {
  display: inline-flex;
  gap: 0.4rem;
  align-items: stretch;
}

.export-btn-group .btn {
  padding: 0.4rem 0.95rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
</style>
