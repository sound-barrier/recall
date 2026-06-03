<script setup lang="ts">
// Sticky bulk-action bar for the Matches list. Renders only when
// the parent has selected rows; emits one action per button so
// MatchesView's action handlers (hideSelected, beginMoveLive, etc.)
// stay where they wire to App.vue's API.
//
// Extracted from MatchesView.vue to pay down the SFC-size debt
// (TECHNICAL_DEBT.md item 4). Behavior contract is unchanged —
// existing e2e in match-bulk-hide-drawer.spec.ts is the load-bearing
// test.

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
}>()

const emit = defineEmits<{
  selectAll:    []
  hide:         []
  exportBundle: []
  moveBegin:    []
  moveCommit:   [target: string]
  moveCancel:   []
  clear:        []
}>()
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
</style>
