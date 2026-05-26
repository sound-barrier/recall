<script setup lang="ts">
import type { MatchRecord, MatchAnnotationInput } from '../api'
import type { MatchGroup, WLDTally } from '../match-helpers'
import MatchCard from './MatchCard.vue'

// Recursive section for one node in the Month → Week → Day tree.
// Renders its own header (caret + label + W/L/D chyron) and, when
// expanded, either child sections (month/week) or MatchCards (day).
//
// Built as a single recursive component (Vue resolves the self-import
// automatically via the SFC's filename) rather than three flat
// components because every header shares the same caret + tally
// behaviour — the only real per-level differences are typography and
// indent, and those are CSS scope concerns.
//
// MatchCard event surface stays untouched: this component just relays
// every per-card emit upward.

const props = defineProps<{
  group: MatchGroup<MatchRecord>
  // Functional accessors so the recursive descent doesn't have to thread
  // state stores around. Same shape App.vue exposes to MatchCard for
  // per-card expanded / sources / preview / filter state.
  isGroupExpanded: (key: string) => boolean
  isExpanded:      (id: string) => boolean
  isSourcesOpen:   (id: string) => boolean
  previewOpen:     Record<string, boolean>
  previewError:    Record<string, boolean>
  isActive:        (field: string, value: string) => boolean
  // Card position offset across the whole tree, used to stagger
  // match-enter animations. Parent passes its running counter down so
  // groups don't re-zero their delays.
  cardOffset?:     number
  // 'compact' | 'comfortable' — forwarded to MatchCard. Optional so
  // existing tests that don't care about density can omit it.
  densityMode?:    'comfortable' | 'compact'
}>()

const emit = defineEmits<{
  'toggle-group':    [key: string]
  'toggle-expand':   [id: string]
  'toggle-sources':  [id: string]
  'toggle-preview':  [filename: string]
  'preview-error':   [filename: string]
  'filter-toggle':   [field: string, value: string]
  'set-leaver-annotation': [matchKey: string, leaver: '' | 'self' | 'team' | 'enemy']
  'set-match-annotation':  [matchKey: string, input: MatchAnnotationInput]
}>()

const open = (): boolean => props.isGroupExpanded(props.group.key)

// Aria role: each header is a button-like control; the child container
// gets aria-hidden when collapsed so AT users skip the subtree.

// Used by the chyron to size the W and L bars relative to the largest
// of the two — so a 9-1 record reads as a strong tilt without
// math-on-the-fly in the template.
function ratio(t: WLDTally, key: 'w' | 'l'): number {
  const total = t.w + t.l + t.d
  return total === 0 ? 0 : (t[key] / total) * 100
}

// Per-card animation index. Pre-computed once per render — recursive
// renders pass updated offsets down.
function cardDelayMs(localIdx: number): number {
  const offset = props.cardOffset ?? 0
  return Math.min(offset + localIdx, 12) * 28
}
</script>

<template>
  <section
    class="mg"
    :class="[`mg-level-${group.level}`, { open: open() }]"
    :data-key="group.key"
  >
    <button
      type="button"
      class="mg-head"
      :aria-expanded="open()"
      @click="emit('toggle-group', group.key)"
    >
      <span class="mg-caret" :class="{ open: open() }" aria-hidden="true">›</span>

      <span class="mg-label">
        {{ group.label }}
        <!-- Match count after the label for the UNKNOWN DATE bucket
             only — months / weeks / days infer scale from the W/L/D
             chyron, but the unknown bucket has no sub-tree to hint at
             cardinality. -->
        <span
          v-if="group.level === 'unknown' && group.matches"
          class="mg-count"
        >({{ group.matches.length }} match{{ group.matches.length === 1 ? '' : 'es' }})</span>
      </span>

      <!-- W/L/D chyron — three slabs separated by a vertical hairline.
           Wins glow accent on hover; losses dim down; draws are neutral.
           A faint two-track bar underneath shows the W vs L tilt. -->
      <span class="mg-tally" aria-label="record">
        <span class="t t-w" :class="{ zero: group.tally.w === 0 }">
          <em>{{ group.tally.w }}</em><span class="suf">W</span>
        </span>
        <span class="t t-l" :class="{ zero: group.tally.l === 0 }">
          <em>{{ group.tally.l }}</em><span class="suf">L</span>
        </span>
        <span v-if="group.tally.d > 0" class="t t-d">
          <em>{{ group.tally.d }}</em><span class="suf">D</span>
        </span>

        <span class="mg-bar" aria-hidden="true">
          <span class="mg-bar-w" :style="{ width: ratio(group.tally, 'w') + '%' }" />
          <span class="mg-bar-l" :style="{ width: ratio(group.tally, 'l') + '%' }" />
        </span>
      </span>
    </button>

    <transition name="mg-collapse">
      <div v-show="open()" class="mg-body" :aria-hidden="!open()">
        <!-- Branches: month/week recurse into MatchGroupSection.
             Leaf nodes (day + unknown) render MatchCards directly.
             Using `matches !== undefined` as the guard is more honest
             than checking the level: both `day` and `unknown` are
             leaves, and any future leaf-shaped level gets handled too. -->
        <template v-if="group.matches !== undefined">
          <MatchCard
            v-for="(rec, idx) in group.matches"
            :id="`match-${rec.match_key}`"
            :key="rec.match_key"
            :style="{ animationDelay: cardDelayMs(idx) + 'ms' }"
            :record="rec"
            :index="(cardOffset ?? 0) + idx"
            :is-expanded="isExpanded(rec.match_key)"
            :is-sources-open="isSourcesOpen(rec.match_key)"
            :preview-open="previewOpen"
            :preview-error="previewError"
            :is-active="isActive"
            :density-mode="densityMode"
            @toggle-expand="emit('toggle-expand', rec.match_key)"
            @toggle-sources="emit('toggle-sources', rec.match_key)"
            @toggle-preview="(fn: string) => emit('toggle-preview', fn)"
            @preview-error="(fn: string) => emit('preview-error', fn)"
            @filter-toggle="(field: string, value: string) => emit('filter-toggle', field, value)"
            @set-leaver-annotation="(k: string, l: '' | 'self' | 'team' | 'enemy') => emit('set-leaver-annotation', k, l)"
            @set-match-annotation="(k: string, input: MatchAnnotationInput) => emit('set-match-annotation', k, input)"
          />
        </template>

        <template v-else>
          <MatchGroupSection
            v-for="(child, idx) in group.children ?? []"
            :key="child.key"
            :group="child"
            :is-group-expanded="isGroupExpanded"
            :is-expanded="isExpanded"
            :is-sources-open="isSourcesOpen"
            :preview-open="previewOpen"
            :preview-error="previewError"
            :is-active="isActive"
            :card-offset="(cardOffset ?? 0) + idx"
            :density-mode="densityMode"
            @toggle-group="(k: string) => emit('toggle-group', k)"
            @toggle-expand="(id: string) => emit('toggle-expand', id)"
            @toggle-sources="(id: string) => emit('toggle-sources', id)"
            @toggle-preview="(fn: string) => emit('toggle-preview', fn)"
            @preview-error="(fn: string) => emit('preview-error', fn)"
            @filter-toggle="(field: string, value: string) => emit('filter-toggle', field, value)"
            @set-leaver-annotation="(k: string, l: '' | 'self' | 'team' | 'enemy') => emit('set-leaver-annotation', k, l)"
            @set-match-annotation="(k: string, input: MatchAnnotationInput) => emit('set-match-annotation', k, input)"
          />
        </template>
      </div>
    </transition>
  </section>
</template>

<style scoped>
/* ──────────────────────────────────────────────────────────────
   Match Group Section — Month / Week / Day outline headers
   Aesthetic: editorial sports-broadcast chyron. Month label is the
   headline (display-font, generous letter-spacing, all caps); week
   is the lede; day is the byline. Each level's W/L/D slab is the
   side panel of a scoreboard graphic, with a two-track bar showing
   the win-rate tilt at a glance.
   ────────────────────────────────────────────────────────────── */

.mg {
  position: relative;
}

/* The shared head: chevron + label + tally, laid out so the tally
   always anchors to the right of a fluid label column. The grid lets
   the bar continue across the row width without the label or tally
   collapsing on small viewports. */
.mg-head {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: baseline;
  gap: 0.7rem;
  width: 100%;
  padding: 0.55rem 0.85rem;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  border-radius: 2px;
  transition: background 140ms ease, color 140ms ease;
}

.mg-head:hover {
  background: var(--surface-2);
  color: var(--text-strong, var(--text));
}

.mg-head:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.mg-caret {
  display: inline-block;
  font-size: 1.05rem;
  line-height: 1;
  color: var(--text-faint);
  transform: rotate(0deg);
  transform-origin: 55% 50%;
  transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1), color 140ms ease;
}

.mg-caret.open {
  transform: rotate(90deg);
  color: var(--accent);
}

.mg-label {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

/* ── W/L/D chyron ─────────────────────────────────────────────── */

.mg-tally {
  position: relative;
  display: inline-flex;
  align-items: baseline;
  gap: 0.55rem;
  font-feature-settings: "tnum";
  font-variant-numeric: tabular-nums;
  color: var(--text-faint);
  white-space: nowrap;
}

.mg-tally .t {
  display: inline-flex;
  align-items: baseline;
  gap: 0.18rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-size: 0.74rem;
}

.mg-tally .t em {
  font-style: normal;
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--text);
}

.mg-tally .t .suf {
  opacity: 0.65;
  font-size: 0.7rem;
}

.mg-tally .t.zero em {
  color: var(--text-faint);
  font-weight: 500;
}

/* Result-colored slab markers. Subtle so they don't fight the W/L/D
   tinting on individual MatchCards. */
.mg-tally .t-w em { color: var(--result-victory, #6cc678); }
.mg-tally .t-l em { color: var(--result-defeat, #d96a6a); }
.mg-tally .t-d em { color: var(--text-faint); }

/* Two-track win/loss bar that grows behind/under the chyron. Placed
   absolutely so it doesn't push the layout around. */
.mg-bar {
  position: absolute;
  bottom: -0.35rem;
  right: 0;
  display: flex;
  width: 6rem;
  max-width: 32vw;
  height: 2px;
  background: var(--border);
  border-radius: 1px;
  overflow: hidden;
  opacity: 0.85;
}

.mg-bar-w {
  background: var(--result-victory, #6cc678);
  transition: width 360ms cubic-bezier(0.16, 1, 0.3, 1);
}

.mg-bar-l {
  background: var(--result-defeat, #d96a6a);
  transition: width 360ms cubic-bezier(0.16, 1, 0.3, 1);
}

/* ── Per-level typography ─────────────────────────────────────── */

/* Year — top-level chronological divider. Only renders when records
   span multiple calendar years (single-year datasets unwrap to a
   month-rooted tree). Sized larger than Month and given an extra
   accent rule above so the year boundary reads as a major
   transition — closer to a section break than a header. */
.mg-level-year > .mg-head {
  margin-top: 2rem;
  padding: 1.1rem 0.85rem 0.75rem;
  border-top: 2px solid var(--border-strong, var(--border));
}

.mg-level-year:first-child > .mg-head {
  margin-top: 0;
  border-top: 0;
}

.mg-level-year > .mg-head .mg-label {
  font-family: var(--brand, 'OW Wordmark', 'Russo One', 'Industry Black', sans-serif);
  font-size: 1.95rem;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
  color: var(--accent, var(--text-strong, var(--text)));
}

.mg-level-year > .mg-head .mg-tally .t em { font-size: 1.15rem; }
.mg-level-year > .mg-head .mg-bar { width: 12rem; height: 3px; bottom: -0.35rem; }

/* Month groups inside a Year wrapper don't need their own top-rule —
   the year above already separated them from the previous year. Keep
   the existing border for the standalone (single-year) case. */
.mg-level-year .mg-level-month > .mg-head {
  margin-top: 0.9rem;
}

.mg-level-month > .mg-head {
  /* Editorial headline treatment. Brand display font carries the
     month + year; the bar sits underneath like a chyron stripe. */
  margin-top: 1.3rem;
  padding: 0.95rem 0.85rem 0.65rem;
  border-top: 1px solid var(--border);
}

.mg-level-month:first-child > .mg-head {
  margin-top: 0;
  border-top: 0;
}

.mg-level-month > .mg-head .mg-label {
  font-family: var(--brand, 'OW Wordmark', 'Russo One', 'Industry Black', sans-serif);
  font-size: 1.45rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-strong, var(--text));
}
.mg-level-month > .mg-head .mg-tally .t em { font-size: 1.05rem; }
.mg-level-month > .mg-head .mg-bar { width: 10rem; height: 3px; bottom: -0.3rem; }

.mg-level-week > .mg-head {
  padding-left: 1.85rem;
  padding-top: 0.7rem;
  padding-bottom: 0.4rem;
  border-top: 1px dashed transparent;
}

.mg-level-week > .mg-head .mg-label {
  font-size: 0.82rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-faint);
  font-weight: 600;
}
.mg-level-week:not(:first-child) > .mg-head { border-top-color: var(--border); }

.mg-level-day > .mg-head {
  padding-left: 2.95rem;
  padding-top: 0.4rem;
  padding-bottom: 0.4rem;
}

.mg-level-day > .mg-head .mg-label {
  font-size: 0.78rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text);
  font-weight: 600;
}
.mg-level-day > .mg-head .mg-bar { width: 4.5rem; }

/* ── UNKNOWN DATE bucket ──────────────────────────────────────
   Triage group for records that lack a parseable date. Same head
   shape as a month so the W/L/D chyron renders identically — but
   the label is tinted toward `--text-faint` and the rule above
   is dashed, visually separating chronological browsing from
   triage. */

.mg-level-unknown > .mg-head {
  margin-top: 1.3rem;
  padding: 0.85rem 0.85rem 0.6rem;
  border-top: 1px dashed var(--border-strong, var(--border));
}

.mg-level-unknown:first-child > .mg-head {
  margin-top: 0;
  border-top: 0;
}

.mg-level-unknown > .mg-head .mg-label {
  font-family: var(--brand, 'OW Wordmark', 'Russo One', 'Industry Black', sans-serif);
  font-size: 1.15rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-faint);
  display: inline-flex;
  align-items: baseline;
  gap: 0.55rem;
}

.mg-level-unknown > .mg-head .mg-tally .t em { font-size: 0.95rem; }
.mg-level-unknown > .mg-head .mg-bar { width: 8rem; height: 2px; bottom: -0.3rem; }

.mg-count {
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: none;
  color: var(--text-faint);
  opacity: 0.75;
}

.mg-level-unknown .mg-body {
  padding-left: 0.85rem;
  padding-top: 0.4rem;
  padding-bottom: 0.6rem;
  gap: 0.55rem;
}

/* ── Body / nested sections ───────────────────────────────────── */

.mg-body {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.mg-level-day .mg-body {
  padding-left: 2.95rem;
  padding-top: 0.3rem;
  padding-bottom: 0.6rem;
  border-left: 1px solid var(--border);
  margin-left: 1.55rem;
  gap: 0.55rem;
}

/* Collapse transition. Uses max-height + opacity rather than display:
   none so v-show animates. max-height is overshot deliberately —
   matches the longest plausible day. */
.mg-collapse-enter-active,
.mg-collapse-leave-active {
  transition: max-height 280ms cubic-bezier(0.16, 1, 0.3, 1),
              opacity 220ms ease;
  overflow: hidden;
}

.mg-collapse-enter-from,
.mg-collapse-leave-to {
  max-height: 0 !important;
  opacity: 0;
}

.mg-collapse-enter-to,
.mg-collapse-leave-from {
  max-height: 9000px;
  opacity: 1;
}
</style>
