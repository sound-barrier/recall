<script setup lang="ts">
import { computed } from 'vue'

import type { Density } from '@/composables/matches/table/useDensity'
import { NOTHING_TO_SEND_REASON, SESSION_SHARE_REASON, useWriteGate } from '@/composables/shared/useWriteGate'
import { useAddMatchMenu } from '@/composables/matches/list/useAddMatchMenu'

// The Matches members-section header toolbar: the "N matches" title, the
// Sort+Group trigger, the row-density segmented control, and the
// jump-to-undated button. Extracted from MatchesView (the workspace shell)
// so the shell sheds this control cluster + its scoped CSS; state lives in
// the shell + useSortGroupMenu, threaded in as props / events back out.
const props = defineProps<{
  matchCount: number
  sortGroupOpen: boolean
  sortGroupLabel: string
  density: Density
  undatedCount: number
  // True when the list is grouped (date / tag dividers exist). The
  // Expand/Collapse-all control only makes sense then — flat mode has no
  // sections to fold.
  grouped: boolean
  /**
   * How many matches "Send to a coach…" would send — the ticked rows when
   * there are any, otherwise everything showing. The count rides the label
   * so the ticked-rows-win rule is visible BEFORE the click rather than
   * discovered after it.
   */
  shareTargetCount: number
}>()

const emit = defineEmits<{
  'toggle-sort-group': [e: MouseEvent]
  'set-density': [density: Density]
  'jump-to-undated': []
  // Open the manual-entry modal (hand-enter a match — no OCR needed). The
  // primary entry point for the no-Tesseract persona; always reachable since
  // the toolbar renders even with an empty set.
  'add-match': []
  /** Open the Send-to-a-coach dialog over the ticked rows, or the narrow. */
  'send-to-coach': []
  // Open the same modal in its stripped leaver-exit mode — map + result only,
  // for a match Overwatch dropped from history because you left early.
  'add-leaver-exit': []
  // Merge matches from a shared bundle (.zip), or open a coach's returned
  // notes — one affordance takes both, and the server sniffs which. Additive
  // — the counterpart to
  // the selection-only "Export backup" in the bulk action bar.
  'import-matches': []
  // Fold / unfold every group section at once.
  'expand-all': []
  'collapse-all': []
}>()

// Manual add + bundle import write matches — rejected (409) on the read-only
// sample profile AND while a coaching session holds the view, so disable
// them there with the reason on the title.
const { writesLocked, lockedTitle, sessionActive } = useWriteGate()

// Sending is a read, so the write gate is the wrong test — but during a
// session the list is the coach's loaned corpus, and a bundle of someone
// else's matches signed with your handle is worse than a blocked write.
const sendTitle = computed(() => {
  if (sessionActive.value) return SESSION_SHARE_REASON
  if (props.shareTargetCount === 0) return NOTHING_TO_SEND_REASON
  return 'Send these matches to a coach'
})
// Destructured to top-level consts: a template `ref="…"` binds by NAME and
// cannot take a dotted path, so `ref="addMenu.triggerEl"` would silently
// register a ref literally called "addMenu.triggerEl" and leave the
// composable's element refs null — breaking outside-click and Esc-restore.
const {
  open: addMenuOpen,
  triggerEl: addMenuTrigger,
  menuEl: addMenuPanel,
  toggle: toggleAddMenu,
  run: runAddMenuItem,
} = useAddMatchMenu()
</script>

<template>
  <header class="leaves-head">
    <div class="leaves-head-left">
      <span class="eyebrow accent leaves-eyebrow">Members</span>
      <h3 class="leaves-title">
        {{ matchCount }} matches in this set
      </h3>
    </div>
    <div class="leaves-head-controls">
      <div class="add-match" :class="{ open: addMenuOpen }">
        <button
          ref="addMenuTrigger"
          type="button"
          class="add-match-btn"
          data-add-match
          :disabled="writesLocked"
          :aria-expanded="addMenuOpen ? 'true' : 'false'"
          aria-haspopup="menu"
          :title="lockedTitle('Record a match by hand — no screenshots needed')"
          @click="toggleAddMenu"
        >
          <span class="add-match-plus" aria-hidden="true">+</span>
          Add match
          <span class="add-match-caret" aria-hidden="true">▾</span>
        </button>
        <div
          v-if="addMenuOpen"
          ref="addMenuPanel"
          class="add-match-menu"
          role="menu"
          aria-label="Add a match"
        >
          <button
            type="button"
            class="add-match-item"
            role="menuitem"
            data-add-match-full
            @click="runAddMenuItem(() => emit('add-match'))"
          >
            Full entry…
          </button>
          <button
            type="button"
            class="add-match-item"
            role="menuitem"
            data-add-match-leaver-exit
            title="Overwatch drops matches you leave early — record one with just the map and the result"
            @click="runAddMenuItem(() => emit('add-leaver-exit'))"
          >
            Left after a leaver…
          </button>
        </div>
      </div>
      <button
        type="button"
        class="import-matches-btn"
        data-send-to-coach
        :disabled="sessionActive || shareTargetCount === 0"
        :title="sendTitle"
        @click="emit('send-to-coach')"
      >
        Send {{ shareTargetCount }} to a coach…
      </button>
      <button
        type="button"
        class="import-matches-btn"
        data-import-matches
        :disabled="writesLocked"
        :title="lockedTitle('Merge a shared bundle (.zip), or open the notes a coach sent back')"
        @click="emit('import-matches')"
      >
        Import matches or notes…
      </button>
      <button
        type="button"
        class="sort-group-trigger"
        :class="{ open: sortGroupOpen }"
        data-sort-group-trigger
        aria-haspopup="dialog"
        :aria-expanded="sortGroupOpen ? 'true' : 'false'"
        :title="`Sort and group — currently ${sortGroupLabel}`"
        @click="(e) => emit('toggle-sort-group', e)"
      >
        <span class="sort-group-label">{{ sortGroupLabel }}</span>
        <span class="sort-group-caret" aria-hidden="true">▾</span>
      </button>
      <fieldset class="seg" aria-label="Row density">
        <legend class="seg-legend">
          Density
        </legend>
        <button
          class="seg-btn"
          :class="{ picked: density === 'comfortable' }"
          :aria-pressed="density === 'comfortable' ? 'true' : 'false'"
          :data-density-pick="density === 'comfortable' ? 'comfortable' : undefined"
          title="Roomy row spacing"
          @click="emit('set-density', 'comfortable')"
        >
          Cozy
        </button>
        <button
          class="seg-btn"
          :class="{ picked: density === 'compact' }"
          :aria-pressed="density === 'compact' ? 'true' : 'false'"
          :data-density-pick="density === 'compact' ? 'compact' : undefined"
          title="Tighter row spacing — more rows per screen"
          @click="emit('set-density', 'compact')"
        >
          Compact
        </button>
        <button
          class="seg-btn"
          :class="{ picked: density === 'data' }"
          :aria-pressed="density === 'data' ? 'true' : 'false'"
          :data-density-pick="density === 'data' ? 'data' : undefined"
          title="Table view — sortable columns, hairline rows"
          @click="emit('set-density', 'data')"
        >
          Data
        </button>
      </fieldset>
      <fieldset v-if="grouped && density !== 'data'" class="seg" aria-label="Fold all sections">
        <legend class="seg-legend">
          Sections
        </legend>
        <button
          type="button"
          class="seg-btn"
          data-expand-all
          title="Expand every group section"
          @click="emit('expand-all')"
        >
          Expand all
        </button>
        <button
          type="button"
          class="seg-btn"
          data-collapse-all
          title="Collapse every group section"
          @click="emit('collapse-all')"
        >
          Collapse all
        </button>
      </fieldset>
      <!-- Jump to the "No date" section at the bottom of the
               leaves list. useMatchesGroup always appends the
               undated bucket last, regardless of sort order; this
               button gives the user a one-click path to triage
               those rows without scrolling past the dated corpus.
               Disabled (predictable layout > collapsed layout) when
               there are no undated matches in the current narrow. -->
      <button
        v-if="density !== 'data'"
        type="button"
        class="btn ghost jump-to-undated"
        :class="{ 'has-undated': undatedCount > 0 }"
        :disabled="undatedCount === 0"
        :title="undatedCount === 0
          ? 'No undated matches in this view'
          : `Jump to ${undatedCount} undated match${undatedCount === 1 ? '' : 'es'}`"
        data-jump-to-undated
        @click="emit('jump-to-undated')"
      >
        <span class="jump-glyph" aria-hidden="true">↓</span>
        {{ undatedCount }} undated
      </button>
    </div>
  </header>
</template>

<style scoped src="./matches-list-toolbar.css"></style>
