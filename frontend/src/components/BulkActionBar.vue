<script setup lang="ts">
// Sticky bulk-action bar for the Matches list. Renders only when
// the parent has selected rows; emits one action per button so
// MatchesView's action handlers (hideSelected, beginMoveLive, etc.)
// stay where they wire to App.vue's API.
import { ref } from 'vue'
import type { PlayMode, QueueType } from '../api'
import TypeaheadDropdown from './TypeaheadDropdown.vue'

defineProps<{
  // Active selection size. Bar only mounts when > 0.
  selectedCount: number
  // Total rows currently visible in the list. Drives the "Select
  // all (N)" affordance — the button hides when selection ≡ all.
  sortedCount: number
  // Available move targets. Bar shows "Move to…" only when ≥ 1.
  otherProfiles: readonly string[]
  // Sub-mode the parent flips into via @move-begin. While === 'live'
  // the bar replaces its main button row with the per-target
  // chooser. The parent flips back to null via @move-commit /
  // @move-cancel.
  movePickerOpen: 'live' | 'archive' | null
  // Tag vocabulary across the narrowed set — drives the Tag ▾
  // dropdown's suggestions. Defaults to an empty list when no
  // vocabulary is threaded in; the free-text Enter path still
  // works (so a brand-new user can still bulk-tag).
  availableTags?: readonly string[]
}>()

const emit = defineEmits<{
  selectAll:    []
  hide:         []
  exportBundle: []
  moveBegin:    []
  moveCommit:   [target: string]
  moveCancel:   []
  clear:        []
  // Bulk-write the same play_mode / queue_type to every selected
  // match. Empty string clears (bulk Clear) — the "Unknown mode
  // (type)" semantic from the leaf chip + narrow filter, applied
  // in one transaction. Parent (MatchesView) calls api.ts's
  // BulkSetMatchPlayMode / BulkSetMatchQueue, then reloads.
  bulkPlayMode: [playMode: PlayMode]
  bulkQueue:    [queueType: QueueType]
  // Bulk-tag every selected match. Parent (MatchesView) does the
  // read-modify-write per record via api.SetMatchAnnotation —
  // existing tags survive; the new one is appended (idempotent if
  // already present). Empty string is currently unused but reserved
  // for a future "Clear all tags" affordance.
  bulkTag:      [tag: string]
}>()

// Mutually-exclusive Set-play-mode / Set-queue / Tag menus. Opening
// one closes the others so the bar never sprouts two open dropdowns.
const openMenu = ref<'' | 'play-mode' | 'queue' | 'tag'>('')
function toggleMenu(name: 'play-mode' | 'queue' | 'tag') {
  openMenu.value = openMenu.value === name ? '' : name
}

function pickPlayMode(v: PlayMode) {
  openMenu.value = ''
  emit('bulkPlayMode', v)
}

function pickQueue(v: QueueType) {
  openMenu.value = ''
  emit('bulkQueue', v)
}

function pickTag(v: string) {
  const tag = v.trim().toLowerCase()
  if (!tag) return
  openMenu.value = ''
  emit('bulkTag', tag)
}
</script>

<template>
  <!-- Sticky bulk-action bar, surfaced contextually whenever any row
       is selected — same pattern Gmail / Linear / GitHub Issues use.
       Sticky within the parent section so it follows the user down
       the leaves list. -->
  <div
    class="bulk-action-bar"
    role="region"
    aria-label="Bulk action bar"
  >
    <span class="bab-glyph" aria-hidden="true">▣</span>
    <span class="bab-count">{{ selectedCount }} selected</span>
    <span class="bab-spacer" aria-hidden="true" />
    <template v-if="movePickerOpen !== 'live'">
      <button
        v-if="selectedCount < sortedCount"
        type="button"
        class="bulk-select-all"
        @click="emit('selectAll')"
      >
        Select all ({{ sortedCount }})
      </button>
      <button type="button" class="bulk-hide" @click="emit('hide')">
        <span class="bab-btn-glyph" aria-hidden="true">⌀</span>
        Hide
      </button>
      <button
        type="button"
        class="bulk-export"
        data-testid="bulk-export-bundle"
        @click="emit('exportBundle')"
      >
        <span class="bab-btn-glyph" aria-hidden="true">📦</span>
        Export bundle…
      </button>
      <!-- Set play-mode menu — bulk write to the new
           PUT /api/v1/matches/play-mode collection endpoint. -->
      <div class="bab-menu-wrap">
        <button
          type="button"
          class="bulk-mode"
          :class="{ open: openMenu === 'play-mode' }"
          :aria-expanded="openMenu === 'play-mode' ? 'true' : 'false'"
          aria-haspopup="menu"
          data-bulk-menu="play-mode"
          @click="toggleMenu('play-mode')"
        >
          Set play mode <span class="bab-caret" aria-hidden="true">▾</span>
        </button>
        <ul
          v-if="openMenu === 'play-mode'"
          class="bab-menu"
          role="menu"
          aria-label="Set play mode for selected matches"
        >
          <li>
            <button type="button" role="menuitem" class="bab-menu-item" data-bulk-set-play-mode="quickplay" @click="pickPlayMode('quickplay')">
              Quickplay
            </button>
          </li>
          <li>
            <button type="button" role="menuitem" class="bab-menu-item" data-bulk-set-play-mode="competitive" @click="pickPlayMode('competitive')">
              Competitive
            </button>
          </li>
          <li class="bab-menu-divider" role="separator" />
          <li>
            <button type="button" role="menuitem" class="bab-menu-item bab-menu-item-clear" data-bulk-set-play-mode="" @click="pickPlayMode('')">
              Clear (Unknown mode)
            </button>
          </li>
        </ul>
      </div>

      <!-- Set queue menu — bulk write to the new
           PUT /api/v1/matches/queue-type collection endpoint. -->
      <div class="bab-menu-wrap">
        <button
          type="button"
          class="bulk-mode"
          :class="{ open: openMenu === 'queue' }"
          :aria-expanded="openMenu === 'queue' ? 'true' : 'false'"
          aria-haspopup="menu"
          data-bulk-menu="queue"
          @click="toggleMenu('queue')"
        >
          Set queue <span class="bab-caret" aria-hidden="true">▾</span>
        </button>
        <ul
          v-if="openMenu === 'queue'"
          class="bab-menu"
          role="menu"
          aria-label="Set queue type for selected matches"
        >
          <li>
            <button type="button" role="menuitem" class="bab-menu-item" data-bulk-set-queue="role" @click="pickQueue('role')">
              Role Queue
            </button>
          </li>
          <li>
            <button type="button" role="menuitem" class="bab-menu-item" data-bulk-set-queue="open" @click="pickQueue('open')">
              Open Queue
            </button>
          </li>
          <li class="bab-menu-divider" role="separator" />
          <li>
            <button type="button" role="menuitem" class="bab-menu-item bab-menu-item-clear" data-bulk-set-queue="" @click="pickQueue('')">
              Clear (Unknown mode type)
            </button>
          </li>
        </ul>
      </div>

      <!-- Tag menu — opens a TypeaheadDropdown over availableTags.
           Selecting an existing tag adopts it on every selected row;
           typing a new tag + Enter coins it. -->
      <div class="bab-menu-wrap">
        <button
          type="button"
          class="bulk-mode"
          :class="{ open: openMenu === 'tag' }"
          :aria-expanded="openMenu === 'tag' ? 'true' : 'false'"
          aria-haspopup="menu"
          data-bulk-menu="tag"
          @click="toggleMenu('tag')"
        >
          Tag <span class="bab-caret" aria-hidden="true">▾</span>
        </button>
        <div
          v-if="openMenu === 'tag'"
          class="bab-menu bab-menu-tag"
          role="menu"
          aria-label="Tag selected matches"
        >
          <TypeaheadDropdown
            listbox-id="bulk-tag-listbox"
            label="Tag selected matches"
            :options="[...(availableTags ?? [])]"
            :open="true"
            placeholder="type a tag…"
            empty-message="no tags yet — type a new one + Enter"
            :show-checkmark="false"
            @select="pickTag"
            @free-text="pickTag"
            @close="openMenu = ''"
          />
        </div>
      </div>

      <button
        v-if="otherProfiles.length > 0"
        type="button"
        class="bulk-move"
        @click="emit('moveBegin')"
      >
        Move to…
      </button>
      <button type="button" class="bulk-cancel" @click="emit('clear')">
        Clear
      </button>
    </template>
    <template v-else>
      <span class="bab-prompt">Move to:</span>
      <button
        v-for="p in otherProfiles"
        :key="p"
        type="button"
        class="bulk-move-target"
        @click="emit('moveCommit', p)"
      >
        {{ p }}
      </button>
      <button type="button" class="bulk-cancel" @click="emit('moveCancel')">
        Cancel
      </button>
    </template>
  </div>
</template>

<style scoped>
.bulk-action-bar {
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

.bulk-action-bar button {
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

.bulk-hide {
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--primary-text-on-accent, #111);
}

.bulk-hide:hover { filter: brightness(1.08); }

.bulk-select-all {
  border: 1px solid var(--accent);
  background: transparent;
  color: var(--accent);
}

.bulk-select-all:hover { background: color-mix(in srgb, var(--accent) 14%, transparent); }

.bulk-move {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
}

.bulk-move:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.bulk-move-target {
  border: 1px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  font-style: italic;
}

.bulk-move-target:hover {
  background: var(--accent);
  color: var(--primary-text-on-accent, #111);
}

.bab-prompt {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-dim);
  font-weight: 700;
}

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

.bulk-mode {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
}

.bulk-mode:hover,
.bulk-mode:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  outline: none;
}

.bulk-mode.open {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}

.bab-caret { font-size: 0.7rem; }

.bab-menu-wrap { position: relative; }

/* Tag menu wraps a TypeaheadDropdown rather than a <ul> menu —
   reset the listbox positioning so the dropdown's own popover
   sits flush under the trigger. Wider min-width than the play-
   mode menu to fit the search input + suggestion rows. */
.bab-menu-tag {
  min-width: 16rem;
  padding: 0.4rem;
}

.bab-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 6;
  min-width: 12rem;
  list-style: none;
  padding: 0.3rem;
  margin: 0;
  background: var(--surface-3, var(--surface-2));
  border: 1px solid var(--border-strong);
  border-radius: 2px;
  box-shadow: 0 8px 18px rgb(0 0 0 / 30%);
}

.bab-menu-item {
  appearance: none;
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.4rem 0.55rem;
  border: 0;
  background: transparent;
  color: var(--text);
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-weight: 700;
  cursor: pointer;
  border-radius: 2px;
  transition: background var(--duration-fast), color var(--duration-fast);
}

.bab-menu-item:hover,
.bab-menu-item:focus-visible {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  outline: none;
}

.bab-menu-item-clear { color: var(--text-dim); }

.bab-menu-divider {
  height: 1px;
  margin: 0.25rem 0;
  background: var(--border);
}
</style>
