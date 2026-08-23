<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'

import { useDatabaseStore } from '@/stores/database'
import { useMatchesStore } from '@/stores/matches'
import { useSettingsStore } from '@/stores/settings'
import { useWriteGate } from '@/composables/shared/useWriteGate'
import { formatIgnoredAt } from '@/match/match-time-helpers'

// Backup & Restore panel:
//   - Backup        — save a complete native SQLite (.db) snapshot.
//   - Import matches — MERGE a shared bundle's matches (additive; no confirm).
//   - Restore       — REPLACE the live DB from a .db snapshot (two-step
//                     arm/confirm danger flow, since it wipes local data).
//
// `.setting-row.danger-row` + `.clear-confirm-group` are shared with the
// SettingsAdvanced Clear-DB row, so those styles stay in the parent stylesheet.

// Reads and writes the stores directly — see SettingsAppearance.
const databaseStore = useDatabaseStore()
const matchesStore = useMatchesStore()
const {
  backingUp, restoring, restoreArmed, importingMatches, backupStatus: status,
} = storeToRefs(databaseStore)
const matchedCount = computed(() => matchesStore.records.length)
const unknownCount = computed(() => matchesStore.unknownRecords.length)

// Automatic backups read the settings store directly (the store-direct
// convention) — the rest of this panel predates it and stays prop-driven.
const settingsStore = useSettingsStore()
const { autoBackup } = storeToRefs(settingsStore)
// Import and Restore write matches — rejected (409) while a coaching session
// profile and while a coaching session is open, so disable them there.
// Backup (read-only) stays enabled.
const { writesLocked, lockedTitle } = useWriteGate()

// Interval segments — mirrors the calendar week-start radiogroup.
const INTERVALS = [
  { days: -1, label: 'Off', title: 'Never back up automatically' },
  { days: 1, label: 'Daily', title: 'Snapshot at most once a day' },
  { days: 7, label: 'Weekly', title: 'Snapshot at most once a week' },
  { days: 30, label: 'Monthly', title: 'Snapshot at most once a month' },
] as const
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
            @click="databaseStore.backup()"
          >
            <span v-if="backingUp">Saving…</span>
            <span v-else>Backup (.db)</span>
          </button>
        </div>
      </div>

      <!-- Automatic backups — the scheduler's interval + newest-snapshot
           status. Snapshots land in <profile>/backups/, newest 3 kept. -->
      <div class="setting-row">
        <div class="setting-info">
          <h4 class="setting-label">
            Automatic Backups
          </h4>
          <p class="setting-desc">
            Recall snapshots your database on a schedule (checked at launch and after each parse). The newest three snapshots are kept in your profile's <strong>backups</strong> folder.
          </p>
          <p v-if="autoBackup" class="setting-meta" data-auto-backup-last>
            <template v-if="autoBackup.last_backup_at">
              Last automatic backup: {{ formatIgnoredAt(autoBackup.last_backup_at) }}
            </template>
            <template v-else>
              No automatic backup yet.
            </template>
            <span v-if="autoBackup.stale" class="setting-meta blocked auto-backup-stale">
              <span class="block-mark" aria-hidden="true">!</span>
              Overdue — a snapshot will be taken after the next parse.
            </span>
          </p>
        </div>
        <div class="setting-control">
          <div
            v-if="autoBackup"
            class="auto-backup-grid"
            role="radiogroup"
            aria-label="Automatic backup interval"
          >
            <button
              v-for="opt in INTERVALS"
              :key="opt.days"
              type="button"
              class="auto-backup-cell"
              role="radio"
              :aria-checked="autoBackup.interval_days === opt.days"
              :class="{ active: autoBackup.interval_days === opt.days }"
              :data-auto-backup-interval="opt.days"
              :title="opt.title"
              @click="settingsStore.setAutoBackupInterval(opt.days)"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- Import matches — additive merge from a shared bundle. -->
      <div class="setting-row">
        <div class="setting-info">
          <h4 class="setting-label">
            Import matches or a coach's notes
            <span class="setting-help" tabindex="0" role="note">
              <span class="setting-help-mark" aria-hidden="true">?</span>
              <span class="setting-help-label">About Import</span>
              <span class="setting-help-pop" role="tooltip">
                Takes either file: a bundle someone exported from their Matches view, or the notes a coach sent back after reviewing yours. Recall tells them apart. <strong>Additive</strong> — matches you already have are skipped, nothing is wiped, and a coach's notes write nothing until you accept them.
              </span>
            </span>
          </h4>
          <p class="setting-desc">
            Merge matches from a <strong>bundle (.zip)</strong> exported from a Matches view, or open the <strong>notes</strong> a coach sent back. Matches are added, never overwritten; a coach's notes open a sheet you decide on, match by match.
          </p>
        </div>
        <div class="setting-control">
          <button
            class="btn ghost"
            :disabled="importingMatches || restoring || backingUp || writesLocked"
            :title="lockedTitle('')"
            @click="databaseStore.importMatches()"
          >
            <span v-if="importingMatches">Importing…</span>
            <span v-else>Import matches or notes…</span>
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
              :disabled="restoring || backingUp || importingMatches || writesLocked"
              :title="lockedTitle('')"
              @click="databaseStore.armRestore()"
            >
              Restore (.db)…
            </button>
          </template>
          <template v-else>
            <div class="clear-confirm-group">
              <button
                class="btn danger"
                :disabled="restoring"
                @click="databaseStore.restore()"
              >
                <span v-if="restoring">Loading…</span>
                <span v-else>Choose File…</span>
              </button>
              <button class="btn ghost" :disabled="restoring" @click="databaseStore.cancelRestore()">
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
/* Segmented interval picker — the SettingsCalendar week-start cell
   language, sized for word labels instead of day letters. (That
   grid's styles are scoped to its own SFC, hence the local copy.) */
.auto-backup-grid {
  display: inline-flex;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  padding: 2px;
  transition: border-color var(--duration-fast) ease;
}

.auto-backup-grid:hover {
  border-color: var(--border-strong);
}

.auto-backup-grid:focus-within {
  border-color: var(--accent);
}

.auto-backup-cell {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  padding: 0 0.7rem;
  background: transparent;
  border: 0;
  border-radius: var(--radius-hair);
  font-family: var(--mono);
  font-size: var(--type-2xs);
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-faint);
  cursor: pointer;
  transition: color var(--duration-fast) ease, background var(--duration-fast) ease, box-shadow var(--duration-fast) ease;
}

.auto-backup-cell:hover {
  color: var(--text);
  background: color-mix(in srgb, var(--text) 3%, transparent);
}

.auto-backup-cell.active {
  /* Full-contrast text: the OW orange on its soft fill sits at ~3.8:1,
     under AA for this 10px-bold label — the ring + fill carry the
     selected state, the text stays var(--text) (a11y.md contrast rule). */
  color: var(--text);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}

.auto-backup-stale {
  display: inline-flex;
  margin-left: 0.5rem;
}
</style>
