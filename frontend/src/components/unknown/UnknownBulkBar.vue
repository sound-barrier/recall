<script setup lang="ts">
import { computed } from 'vue'

import type { UnknownSelectionApi } from '@/composables/unknown/useUnknownSelection'
import { useWriteGate } from '@/composables/shared/useWriteGate'
import { pluralize } from '@/match/match-label-helpers'

// The contextual bar over one Unknown-tab section, up while that section has
// anything ticked.
//
// Dismiss is irreversible for the files it names, so it carries the same
// two-click confirm the per-card button does — the verdict is identical, just
// applied wider. The label names what will actually be suppressed: ticking two
// cards can suppress three screenshots, because a card is dismissed whole.
const props = defineProps<{
  selection: UnknownSelectionApi
  /**
   * What one ticked row IS. Card sections name both numbers because they
   * differ; a failed row is exactly one screenshot, so naming it twice would
   * just print the same figure beside itself.
   */
  rowNoun: 'card' | 'screenshot'
  /** Names the section on its select-all, since three of these can be on screen. */
  selectAllLabel: string
  /**
   * The landmark's name. Its own prop rather than derived from
   * selectAllLabel: stripping "Select all " off that produced lowercase
   * fragments ("needing review bulk actions") and would have silently
   * renamed the landmark if anyone reworded the button.
   */
  regionLabel: string
  /** How many rows the section is showing, so select-all can hide when done. */
  totalRows: number
}>()

const { writesLocked, lockedTitle } = useWriteGate()

const { selectedCount, selectedFiles, armed } = props.selection

// The noun phrase both the armed and unarmed labels are built from, so the two
// can never drift apart.
const target = computed(() => (props.rowNoun === 'screenshot'
  ? pluralize(selectedFiles.value.length, 'screenshot')
  : `${pluralize(selectedCount.value, 'card')} (${pluralize(selectedFiles.value.length, 'screenshot')})`))
</script>

<template>
  <div
    v-if="selectedCount > 0"
    class="unknown-bulk-bar"
    role="region"
    :aria-label="regionLabel"
  >
    <span class="ubb-glyph" aria-hidden="true">▣</span>
    <span class="ubb-count">{{ selectedCount }} selected</span>
    <span class="ubb-spacer" aria-hidden="true" />

    <template v-if="!armed">
      <button
        v-if="selectedCount < totalRows"
        type="button"
        class="ubb-select-all"
        @click="selection.selectAll()"
      >
        {{ selectAllLabel }}
      </button>
      <button type="button" class="ubb-clear" @click="selection.clearSelection()">
        Clear
      </button>
      <button
        type="button"
        class="ubb-dismiss"
        :disabled="writesLocked"
        :title="lockedTitle('Stop showing these screenshots')"
        @click="selection.requestDismiss()"
      >
        Dismiss {{ target }}
      </button>
    </template>

    <template v-else>
      <button type="button" class="ubb-clear" @click="selection.cancelDismiss()">
        Cancel
      </button>
      <button
        type="button"
        class="ubb-dismiss armed"
        :disabled="writesLocked"
        :title="lockedTitle('Stop showing these screenshots')"
        @click="selection.commitDismiss()"
      >
        Confirm dismissing {{ target }}?
      </button>
    </template>
  </div>
</template>

<style scoped>
.unknown-bulk-bar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;

  /* No margin: the bar is a flex child of .unknown-list, whose own gap
     already separates it from the first card. A margin here would stack on
     top of that gap. */
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background: var(--surface-3);
}

.ubb-glyph {
  color: var(--accent);
  font-size: var(--type-md);
}

.ubb-count {
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.ubb-spacer {
  flex: 1;
}

.unknown-bulk-bar button {
  font-family: var(--body);
  font-size: var(--type-sm);
  font-weight: 600;
  padding: 0.35rem 0.7rem;
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  color: var(--text);
  cursor: pointer;
}

.unknown-bulk-bar button:hover:not(:disabled) {
  border-color: var(--text-faint);
}

.unknown-bulk-bar button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ubb-dismiss {
  border-color: var(--loss-line);
  color: var(--loss);
}

/* Armed is the moment of consequence, so it gains weight — but by tint and a
   solid edge, NOT by filling with --loss and writing on top of it. Under the
   dark themes --loss is a light pink (#f9a) tuned to be read as TEXT on a
   surface; --primary-text-on-danger is #fff everywhere except high-contrast,
   so white-on-fill lands at 2.02:1 there. The tinted pairing is the one
   themes.css states it tuned to clear AA on double-layered composites. */
.ubb-dismiss.armed {
  /* A clean base, not a tint. --loss-soft over the bar's own --surface-3
     composites to #d6c3bc under Day, where --loss lands at 4.04:1 — the
     double-tinted case .claude/rules/a11y.md names. Sitting the armed button
     on --surface makes the pair the one the tokens actually guarantee, and
     the weight comes from a doubled edge instead of a fill. */
  background: var(--surface);
  border-color: var(--loss);
  color: var(--loss);
  font-weight: 700;
  box-shadow: 0 0 0 1px var(--loss) inset;
}
</style>
