<script setup lang="ts">
import type { ExportStatus } from '@/composables/settings/useBackupRestore'

// Backup & Restore panel:
//   - Backup        — save a complete native SQLite (.db) snapshot.
//   - Import matches — MERGE a shared bundle's matches (additive; no confirm).
//   - Restore       — REPLACE the live DB from a .db snapshot (two-step
//                     arm/confirm danger flow, since it wipes local data).
//
// `.setting-row.danger-row` + `.clear-confirm-group` are shared with the
// SettingsAdvanced Clear-DB row, so those styles stay in the parent stylesheet.

defineProps<{
  backingUp?:        boolean
  restoring?:        boolean
  restoreArmed?:     boolean
  importingMatches?: boolean
  status?:           ExportStatus | null
  matchedCount?:     number
  unknownCount?:     number
}>()

const emit = defineEmits<{
  'backup':         []
  'arm-restore':    []
  'restore':        []
  'cancel-restore': []
  'import-matches': []
}>()
</script>

<template>
  <div id="sec-backup" class="settings-section">
    <div class="section-header">
      <span class="section-num">06</span>
      <span class="section-slash" aria-hidden="true">/</span>
      <h3 class="section-title">
        Backup &amp; Restore
      </h3>
    </div>
    <div class="setting-rows">
      <!-- Backup — save a native SQLite snapshot. -->
      <div class="setting-row">
        <div class="setting-info">
          <h4 class="setting-label">
            Backup Database
            <span class="setting-help" tabindex="0" role="note">
              <span class="setting-help-mark" aria-hidden="true">?</span>
              <span class="setting-help-label">About Backup</span>
              <span class="setting-help-pop" role="tooltip">
                Saves a complete <strong>SQLite (.db)</strong> snapshot of your database — every match, edit, review, and override. Restore it on this or another machine. Screenshots aren't included.
              </span>
            </span>
          </h4>
          <p class="setting-desc">
            Download a complete <strong>.db</strong> snapshot of your database. Unlike sharing matches, this is a full-fidelity backup you can restore from later.
          </p>
          <p v-if="status && status.ok" class="setting-meta success">
            <span class="block-mark" aria-hidden="true">✓</span>
            {{ status.message }}
          </p>
          <p v-else-if="status && !status.ok" class="setting-meta blocked">
            <span class="block-mark" aria-hidden="true">✕</span>
            {{ status.message }}
          </p>
        </div>
        <div class="setting-control">
          <button
            class="btn ghost"
            :disabled="backingUp || restoring || importingMatches"
            @click="emit('backup')"
          >
            <span v-if="backingUp">Saving…</span>
            <span v-else>Backup (.db)</span>
          </button>
        </div>
      </div>

      <!-- Import matches — additive merge from a shared bundle. -->
      <div class="setting-row">
        <div class="setting-info">
          <h4 class="setting-label">
            Import Matches
            <span class="setting-help" tabindex="0" role="note">
              <span class="setting-help-mark" aria-hidden="true">?</span>
              <span class="setting-help-label">About Import</span>
              <span class="setting-help-pop" role="tooltip">
                Merges matches from a bundle someone exported from their Matches view. <strong>Additive</strong> — matches you already have are skipped, nothing is wiped.
              </span>
            </span>
          </h4>
          <p class="setting-desc">
            Merge matches from a <strong>bundle (.zip)</strong> exported from a Matches view. Adds new matches only — anything already in your database is skipped.
          </p>
        </div>
        <div class="setting-control">
          <button
            class="btn ghost"
            :disabled="importingMatches || restoring || backingUp"
            @click="emit('import-matches')"
          >
            <span v-if="importingMatches">Importing…</span>
            <span v-else>Import matches…</span>
          </button>
        </div>
      </div>

      <!-- Restore — destructive full replace, two-step arm/confirm. -->
      <div class="setting-row" :class="{ 'danger-row': restoreArmed }">
        <div class="setting-info">
          <h4 class="setting-label">
            Restore Database
            <span class="setting-help" tabindex="0" role="note">
              <span class="setting-help-mark" aria-hidden="true">?</span>
              <span class="setting-help-label">About Restore</span>
              <span class="setting-help-pop" role="tooltip">
                Replaces the live database with a <strong>.db</strong> backup. Everything currently stored is lost. Two-step arm/confirm prevents accidental wipes.
              </span>
            </span>
          </h4>
          <p class="setting-desc">
            Restore from a previously-saved <strong>.db</strong> backup. <strong>Replaces</strong> everything currently in the database — local matches not in the backup are lost.
          </p>
          <p v-if="restoreArmed" class="setting-meta blocked">
            <span class="block-mark" aria-hidden="true">⚠</span>
            This wipes {{ (matchedCount ?? 0) + (unknownCount ?? 0) }} record{{ ((matchedCount ?? 0) + (unknownCount ?? 0)) === 1 ? '' : 's' }} before loading the backup.
          </p>
        </div>
        <div class="setting-control">
          <template v-if="!restoreArmed">
            <button
              class="btn danger-outline"
              :disabled="restoring || backingUp || importingMatches"
              @click="emit('arm-restore')"
            >
              Restore (.db)…
            </button>
          </template>
          <template v-else>
            <div class="clear-confirm-group">
              <button
                class="btn danger"
                :disabled="restoring"
                @click="emit('restore')"
              >
                <span v-if="restoring">Loading…</span>
                <span v-else>Choose File…</span>
              </button>
              <button class="btn ghost" :disabled="restoring" @click="emit('cancel-restore')">
                Cancel
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
