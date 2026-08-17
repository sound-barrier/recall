import { ref } from 'vue'
import { defineStore } from 'pinia'

import {
  BackupDatabase,
  ClearDatabase,
  ImportMatches,
  RestoreDatabase,
} from '@/api-client'
import { profileScopedKey } from '@/composables/profile/profileStorage'
import { useBackupRestore } from '@/composables/settings/useBackupRestore'
import { useClearDatabase } from '@/composables/settings/useClearDatabase'
import { useAppStore } from '@/stores/app'
import { useCoachReturnsStore } from '@/stores/coachReturns'
import { useMatchesStore } from '@/stores/matches'
import { useParseStore } from '@/stores/parse'

// Whole-database operations: wipe it, snapshot it, replace it from a
// snapshot, merge a shared bundle into it. Named for the vocabulary the API
// already uses (ClearDatabase / BackupDatabase / RestoreDatabase) rather than
// for the tab they appear in — `stores/settings.ts` is the PREFERENCES store,
// and these are the one-shot destructive operations that merely surface
// alongside the knobs.
//
// Every cross-store reach happens INSIDE a callback, never at setup: the
// reload these operations feed and the return sheet an imported notes archive
// stages both live in other stores, and grabbing one while this store is still
// being built is how a store-setup cycle starts.
export const useDatabaseStore = defineStore('database', () => {
  // Both destructive paths invalidate the same two things: the record cluster
  // the views render, and the suppress-list the Settings panel counts.
  async function reloadRecordsAndIgnored() {
    await useMatchesStore().load()
    await useParseStore().loadIgnored()
  }

  // ── Clear database ────────────────────────────────────────────────
  // pendingClearOpts carries SettingsAdvanced's "Keep suppress-list" choice
  // into the api seam, which takes the flag but not the click that set it.
  const pendingClearOpts = ref<{ keepIgnored: boolean }>({ keepIgnored: false })
  const { clearingDB, clearConfirm, clearDatabase, armClear, cancelClear } = useClearDatabase({
    clearDatabase: () => ClearDatabase(pendingClearOpts.value.keepIgnored),
    afterClear: reloadRecordsAndIgnored,
    resetLastParsedAt: () => {
      useParseStore().lastParsedAt = null
      try { localStorage.removeItem(profileScopedKey('lastParsedAt')) } catch (_) { /* non-fatal */ }
    },
    onError: (m) => useAppStore().setErrorFromRaw(m),
  })
  function onClearDatabase(opts: { keepIgnored: boolean }) {
    pendingClearOpts.value = opts
    return clearDatabase()
  }

  // ── Backup / restore / import ─────────────────────────────────────
  const {
    backingUp,
    restoring,
    restoreArmed,
    importingMatches,
    status: backupStatus,
    backup,
    armRestore,
    cancelRestore,
    restore,
    importMatches,
  } = useBackupRestore({
    backup: BackupDatabase,
    restore: RestoreDatabase,
    importMatches: ImportMatches,
    // A coach's notes archive comes back through the same Import…
    // affordance and merges nothing — it stages a return sheet the player
    // decides on, so the sheet opens and no reload follows.
    onCoachNotes: (sheet) => { useCoachReturnsStore().stageImportedNotes(sheet) },
    // Restore replaces the whole database and an import can carry
    // suppress-list entries — refresh the ignored list along with the
    // cluster so the Settings panel doesn't show a stale one.
    reload: reloadRecordsAndIgnored,
  })

  return {
    clearingDB,
    clearConfirm,
    armClear,
    cancelClear,
    onClearDatabase,
    backingUp,
    restoring,
    restoreArmed,
    importingMatches,
    backupStatus,
    backup,
    armRestore,
    cancelRestore,
    restore,
    importMatches,
  }
})
