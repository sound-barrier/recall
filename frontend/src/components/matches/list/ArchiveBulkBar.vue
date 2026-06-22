<script setup lang="ts">
import type { UseArchiveSelectionApi } from '@/composables/matches/useArchiveSelection'

// Archive bulk action bar — appears in the Hidden drawer as soon as any archive
// row is ticked. Mirrors the live BulkActionBar's contextual pattern but is a
// separate in-place bar for the drawer. Extracted from MatchesArchiveDrawer; the
// drawer passes the archive selection bundle + move-picker state and forwards the
// move-to-profile intents up to MatchesView.
const props = defineProps<{
  archive: UseArchiveSelectionApi
  // True while the shared move-to-profile picker targets the archive bar.
  moveActive: boolean
  otherProfiles: string[]
}>()

const emit = defineEmits<{
  'begin-move': []
  'move-to-profile': [target: string]
  'cancel-move': []
}>()

const {
  hiddenRecords,
  archiveSelectedKeys,
  archiveBulkConfirm,
  clearArchiveSelection,
  selectAllArchive,
  unhideSelectedArchive,
  requestBulkHardDelete,
  cancelBulkHardDelete,
  commitBulkHardDelete,
} = props.archive
</script>

<template>
  <div
    v-if="archiveSelectedKeys.size > 0"
    class="archive-action-bar"
    role="region"
    aria-label="Archive bulk action bar"
  >
    <span class="bab-glyph" aria-hidden="true">▣</span>
    <span class="bab-count">{{ archiveSelectedKeys.size }} selected</span>
    <span class="bab-spacer" aria-hidden="true" />
    <template v-if="!archiveBulkConfirm && !moveActive">
      <button
        v-if="archiveSelectedKeys.size < hiddenRecords.length"
        type="button"
        class="bulk-select-all"
        @click="selectAllArchive"
      >
        Select all ({{ hiddenRecords.length }})
      </button>
      <button type="button" class="bulk-unhide" @click="unhideSelectedArchive">
        Unhide
      </button>
      <button
        v-if="otherProfiles.length > 0"
        type="button"
        class="bulk-move"
        @click="emit('begin-move')"
      >
        Move to…
      </button>
      <button type="button" class="bulk-delete" @click="requestBulkHardDelete">
        Delete forever
      </button>
      <button type="button" class="bulk-cancel" @click="clearArchiveSelection">
        Clear
      </button>
    </template>
    <template v-else-if="moveActive">
      <span class="bab-prompt">Move to:</span>
      <button
        v-for="p in otherProfiles"
        :key="p"
        type="button"
        class="bulk-move-target"
        @click="emit('move-to-profile', p)"
      >
        {{ p }}
      </button>
      <button type="button" class="bulk-cancel" @click="emit('cancel-move')">
        Cancel
      </button>
    </template>
    <template v-else>
      <span class="bab-warn" aria-hidden="true">⚠</span>
      <span class="bab-warn-text">
        Delete {{ archiveSelectedKeys.size }} {{ archiveSelectedKeys.size === 1 ? 'match' : 'matches' }} from the database?
      </span>
      <button type="button" class="bulk-confirm" @click="commitBulkHardDelete">
        Confirm
      </button>
      <button type="button" class="bulk-cancel" @click="cancelBulkHardDelete">
        Cancel
      </button>
    </template>
  </div>
</template>

<style scoped>
/* Mirrors the live BulkActionBar's base shape but is a separate in-place bar for
   the Hidden drawer — separate CSS. */
.archive-action-bar {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--surface-2));
  border-radius: 2px;
  position: sticky;
  top: 0.4rem;
  z-index: 4;
  box-shadow: 0 1px 0 color-mix(in srgb, var(--accent) 30%, transparent);
  margin: 0 0 0.45rem;
}

.bab-glyph { color: var(--accent); font-size: 0.95rem; line-height: 1; }

.bab-count {
  font-family: var(--mono);
  font-size: 0.65rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--text);
}

.bab-spacer { flex: 1 1 auto; }

.bab-warn { color: var(--loss); font-size: 0.95rem; line-height: 1; }

.bab-warn-text {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text);
  font-weight: 700;
}

.archive-action-bar button {
  appearance: none;
  border-radius: 2px;
  padding: 0.32rem 0.7rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  line-height: 1;
}

.bulk-unhide {
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--primary-text-on-accent, #111);
}

.bulk-unhide:hover { filter: brightness(1.08); }

.bulk-delete {
  border: 1px solid color-mix(in srgb, var(--loss) 70%, var(--border));
  background: transparent;
  color: var(--loss);
}

.bulk-delete:hover { background: color-mix(in srgb, var(--loss) 12%, transparent); }

.bulk-confirm {
  border: 1px solid var(--loss);
  background: var(--loss);
  color: var(--primary-text-on-accent, #111);
}

.bulk-confirm:hover { filter: brightness(1.06); }

.bulk-cancel {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
}

.bulk-cancel:hover {
  color: var(--text);
  border-color: var(--text);
}

.bab-btn-glyph { font-size: 0.85rem; }
</style>
