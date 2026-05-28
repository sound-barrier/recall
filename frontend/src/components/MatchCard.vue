<script setup lang="ts">
import type { MatchRecord, MatchAnnotationInput } from '../api'
import MatchCardHeader from './MatchCardHeader.vue'
import MatchCardExpanded from './MatchCardExpanded.vue'

// MatchCard is now a thin outer shell that wires the two children
// (Header always, Expanded only when isExpanded). The collapsed-view
// chip row + the expanded annotation/stats/sources blocks each live
// in their own SFC alongside the scoped CSS that owns them.

defineProps<{
  record: MatchRecord
  index: number
  isExpanded: boolean
  isSourcesOpen: boolean
  previewOpen: Record<string, boolean>
  previewError: Record<string, boolean>
  isActive: (field: string, value: string) => boolean
  // 'compact' tightens card padding + map font and inlines a small
  // E/A/D + damage strip in the tag-row so high-volume players see
  // at-a-glance stats without expanding every match. Optional so
  // existing tests can omit it; defaults to 'comfortable' behaviour.
  densityMode?: 'comfortable' | 'compact'
  // Roving-tabindex flag. The keyboard-shortcuts dispatcher tracks a
  // `focusedCardIndex` ref; only the matching card gets tabindex="0"
  // so Tab lands on the list once and j/k navigates between cards
  // via programmatic .focus() (queried by data-card-index). Optional
  // so existing SFC tests that mount MatchCard without the parent
  // wiring still work.
  isFocused?: boolean
  // Live FilterRail note-search query, forwarded to MatchCardExpanded
  // so the saved Note can render `<mark>` hits in the click-to-edit
  // preview. Optional — omitted in tests that don't exercise the
  // expanded view.
  noteSearch?: string
}>()

const emit = defineEmits<{
  'toggle-expand': []
  'toggle-sources': []
  'toggle-preview': [filename: string]
  'preview-error': [filename: string]
  'filter-toggle': [field: string, value: string]
  'set-leaver-annotation': [matchKey: string, leaver: '' | 'self' | 'team' | 'enemy']
  'set-match-annotation':  [matchKey: string, input: MatchAnnotationInput]
  'set-match-hidden':       [matchKey: string, hidden: boolean]
  // Emitted whenever the card's <article> receives focus (Tab,
  // click on a non-interactive area, or programmatic .focus()).
  // The parent uses this to keep `focusedCardIndex` in sync when
  // the user moves focus via something other than j/k.
  'card-focus':            [index: number]
}>()
</script>

<template>
  <article
    class="match"
    :class="[
      { expanded: isExpanded, compact: densityMode === 'compact', hidden: record.hidden, focused: isFocused },
      `result-${record.data?.result || 'unknown'}`,
    ]"
    :tabindex="isFocused ? 0 : -1"
    :data-card-index="index"
    :aria-current="isFocused ? 'true' : undefined"
    @focus="emit('card-focus', index)"
  >
    <span class="match-bar" aria-hidden="true" />
    <div class="match-body">
      <MatchCardHeader
        :record="record"
        :index="index"
        :is-expanded="isExpanded"
        :is-active="isActive"
        :density-mode="densityMode"
        @toggle-expand="emit('toggle-expand')"
        @filter-toggle="(field: string, value: string) => emit('filter-toggle', field, value)"
      />

      <MatchCardExpanded
        v-if="isExpanded"
        :record="record"
        :is-sources-open="isSourcesOpen"
        :preview-open="previewOpen"
        :preview-error="previewError"
        :is-active="isActive"
        :note-search="noteSearch"
        @toggle-sources="emit('toggle-sources')"
        @toggle-preview="(f: string) => emit('toggle-preview', f)"
        @preview-error="(f: string) => emit('preview-error', f)"
        @filter-toggle="(field: string, value: string) => emit('filter-toggle', field, value)"
        @set-leaver-annotation="(k: string, l: '' | 'self' | 'team' | 'enemy') => emit('set-leaver-annotation', k, l)"
        @set-match-annotation="(k: string, input: MatchAnnotationInput) => emit('set-match-annotation', k, input)"
        @set-match-hidden="(k: string, h: boolean) => emit('set-match-hidden', k, h)"
      />
    </div>
  </article>
</template>

<style scoped>
/* ─── Card chrome ────────────────────────────────────────── */

@keyframes match-enter {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.match {
  position: relative;
  display: flex;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 2px;
  overflow: hidden;
  animation: match-enter 360ms cubic-bezier(0.16, 1, 0.3, 1) both;
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
}
.match:hover { border-color: var(--border-strong); }

/* Keyboard-shortcut focus ring. tabindex="0" + :focus-visible
   shows the browser-native outline only on keyboard focus (j/k or
   Tab), not on click. Plus the logical-focus `.focused` class
   strips a 2px accent stub on the left so the user can still see
   which card is "selected" after focus moves into a modal. */
.match:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.match.focused {
  border-color: var(--accent);
}

.match.expanded {
  border-color: var(--border-strong);
  background: linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%);
}

.match-bar {
  width: 3px;
  background: var(--unknown-line);
  flex-shrink: 0;
  transition: background 200ms ease, width 200ms ease, box-shadow 200ms ease;
}

.match.result-victory .match-bar {
  background: var(--win-line);
  box-shadow: 0 0 12px -2px var(--win-line);
}

.match.result-defeat .match-bar {
  background: var(--loss-line);
  box-shadow: 0 0 12px -2px var(--loss-line);
}

.match.result-draw .match-bar {
  background: var(--draw-line);
  box-shadow: 0 0 12px -2px var(--draw-line);
}
.match.expanded .match-bar { width: 5px; }

.match-body {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0.95rem 1.15rem;
}

/* `.match-header` + the entire `.match-expanded` block + all
   their supporting styles moved to MatchCardHeader.vue /
   MatchCardExpanded.vue. What remains here is the outer .match
   chrome only.

   Light-mode pinpoint overrides for `.hero-name`, `.length-mark`,
   `.match.expanded` background, `.sources` background, and the
   `.source-type-summary` chip migrated to app.css as proper global
   rules — Vue scoped CSS miscompiles the `:global([data-theme="light"]) .x`
   form (see CLAUDE.md). */

/* ─── Compact density (outer body padding only) ──────── */

.match.compact .match-body {
  padding: 0.5rem 0.9rem;
}

/* ─── Dimmed card (hidden-state visual) ──────────────────── */

/* Reduce opacity + desaturate so a hidden record reads as
   "filtered out, but still here for inspection". The match-bar
   along the left edge keeps full opacity so the result colour
   remains scannable in the row. */
.match.hidden {
  opacity: 0.55;
  filter: saturate(0.6);
}

.match.hidden > .match-bar {
  opacity: 1;
}

.match.hidden.expanded {
  opacity: 0.85;
  filter: none;
}

/* `.match-danger` + `.danger-*` styles moved to MatchCardDanger.vue's
   \3c style scoped> block. */

/* ─── Narrow-viewport overrides ──────────────────────────── */

/* Narrow-viewport overrides for the header live in MatchCardHeader.vue. */
</style>
