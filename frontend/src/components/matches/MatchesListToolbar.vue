<script setup lang="ts">
import type { Density } from '@/composables/matches/useDensity'

// The Matches members-section header toolbar: the "N matches" title, the
// Sort+Group trigger, the row-density segmented control, and the
// jump-to-undated button. Extracted from MatchesView (the workspace shell)
// so the shell sheds this control cluster + its scoped CSS; state lives in
// the shell + useSortGroupMenu, threaded in as props / events back out.
defineProps<{
  matchCount: number
  sortGroupOpen: boolean
  sortGroupLabel: string
  density: Density
  undatedCount: number
}>()

const emit = defineEmits<{
  'toggle-sort-group': [e: MouseEvent]
  'set-density': [density: Density]
  'jump-to-undated': []
}>()
</script>

<template>
  <header class="leaves-head">
    <div class="leaves-head-left">
      <span class="leaves-eyebrow">Members</span>
      <h3 class="leaves-title">
        {{ matchCount }} matches in this set
      </h3>
    </div>
    <div class="leaves-head-controls">
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

<style scoped>
.leaves-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 0.85rem;
  flex-wrap: wrap;
}
.leaves-head-left { display: flex; flex-direction: column; gap: 0.1rem; }

.leaves-eyebrow {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;

  /* --accent-text is the theme-aware "accent for text" token: bright
     orange on dark themes (same as --accent), deep rust on day for
     AA contrast on cream. Using --accent directly here failed AA in
     day theme (1.92:1 on cream). */
  color: var(--accent-text);
  font-weight: 700;
}

.leaves-title {
  font-family: var(--display);
  font-style: italic;
  font-weight: 700;
  font-size: 1.1rem;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  margin: 0;
}

/* ─── Leaves-head controls row ───────────────────────────────────
   Three peer affordances — Sort + Group trigger, Density segmented
   control, Jump-to-undated. Each used to ship with its own
   typographic register and height; they now all live on a shared
   ~28 px button shape so the row reads as one family. The shared
   baseline is reproduced under each control's selector rather than
   extracted into a class because Vue's \3c style scoped> doesn't let
   us @extend, and the rules are short enough that DRY-by-mixin
   isn't worth the indirection. */

.leaves-head-controls {
  display: inline-flex;
  gap: 0.5rem;
  align-items: center;
}

/* Combined Sort + Group trigger — single button replaces the prior
   two segmented fieldsets so the head controls fit comfortably
   alongside the Density picker without overflowing the row. */
.sort-group-trigger {
  appearance: none;
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: 2px;
  padding: 0.4rem 0.8rem;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--body);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-dim);
  cursor: pointer;
  transition: color var(--duration-fast) ease,
              border-color var(--duration-fast) ease,
              background var(--duration-fast) ease;
}

.sort-group-trigger:hover {
  color: var(--text);
  border-color: var(--text-faint);
  background: rgb(255 255 255 / 2.5%);
}

.sort-group-trigger.open,
.sort-group-trigger:focus-visible {
  color: var(--text);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  outline: none;
}

.sort-group-label {
  display: inline-block;
}

.sort-group-caret {
  font-size: 0.85rem;
  line-height: 1;
  transform: translateY(-1px);
  transition: transform var(--duration-fast) ease;
}

.sort-group-trigger.open .sort-group-caret {
  transform: translateY(-1px) rotate(180deg);
}

/* Density segmented control (`.seg` + `.seg-btn` × 2). Same overall
   button-row shape as the sort trigger, but two halves joined by a
   shared 1 px divider so they read as a single connected control.
   Only used in this row — safe to keep scoped here rather than
   promoting to app.css. */
.seg {
  appearance: none;
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--border-strong);
  border-radius: 2px;
  background: transparent;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

.seg-legend {
  position: absolute;
  width: 1px; height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.seg-btn {
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: 0;
  padding: 0.4rem 0.8rem;
  font-family: var(--body);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-dim);
  cursor: pointer;
  transition: color var(--duration-fast) ease,
              background var(--duration-fast) ease;
}

.seg-btn + .seg-btn {
  border-left: 1px solid var(--border-strong);
}

.seg-btn:hover {
  color: var(--text);
  background: rgb(255 255 255 / 2.5%);
}

.seg-btn:focus-visible {
  color: var(--text);
  outline: none;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

.seg-btn.picked {
  background: var(--accent);

  /* Documented text-on-accent token so the picked label clears AA
     against the orange fill on every theme — day's accent is the
     same OW orange as dark/night, but day's --surface is a light
     cream that would push white-on-orange to ~1.92:1 (sub-AA). */
  color: var(--primary-text-on-accent);
}

.seg-btn.picked:hover,
.seg-btn.picked:focus-visible {
  /* Keep the orange fill — don't let the shared hover stack lift it
     to a translucent tint, which would visually un-pick the label. */
  background: var(--accent);
  color: var(--primary-text-on-accent);
}

/* ─── Section dividers + leaf rows ─────────────────────────── */

.jump-to-undated {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  white-space: nowrap;

  /* Match the sort/density padding so the three controls share an
     exact button-row height. The .btn ghost padding (0.55 × 0.95)
     would push this control a few px taller than its peers. */
  padding: 0.4rem 0.8rem;
}

.jump-to-undated[disabled] {
  cursor: not-allowed;
  opacity: 0.55;
}

.jump-glyph {
  font-family: var(--mono);
  font-weight: 700;
  color: var(--accent);
  font-size: 0.85rem;
  line-height: 1;
  transform: translateY(-1px);
}

.jump-to-undated[disabled] .jump-glyph {
  color: var(--text-faint);
}

/* Soft emphasis — applied when undatedCount > 0. Hints at "there's
   something to triage" without shouting; the accent tint is subtle
   enough to live alongside the unpicked density button without
   competing for attention. */
.jump-to-undated.has-undated {
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border-strong));
  color: var(--text);
}

.jump-to-undated.has-undated:hover,
.jump-to-undated.has-undated:focus-visible {
  background: color-mix(in srgb, var(--accent) 16%, var(--surface-2));
  border-color: var(--accent);
}

.jump-to-undated.has-undated .jump-glyph {
  color: var(--accent-bright, var(--accent));
}
</style>
