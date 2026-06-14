<script setup lang="ts">
import type { MatchRecord } from '@/api'

// The expanded card's leaver-annotation chooser — three scenario chips
// (self / team / enemy left) + a Clear chip, an ARIA radiogroup. Extracted
// from MatchCardExpanded; reads the record's current leaver and emits
// set-leaver-annotation (toggle-off when the active chip is re-clicked).
defineProps<{
  record: MatchRecord
}>()

const emit = defineEmits<{
  'set-leaver-annotation': [matchKey: string, leaver: '' | 'self' | 'team' | 'enemy']
}>()
</script>

<template>
  <!-- Leaver annotation chooser. Three scenario buttons + a
         Clear option. Active button gets the accent ring; the
         others are tactical-grey ghosts. Wired bottom-up: this
         component emits set-leaver-annotation, App.vue persists
         via SetMatchAnnotation with the other annotation fields
         preserved. Sits above the journal so the read-only "what
         happened" fields (Stats below) flow before the writable
         "what did I think about it" fields (Journal). -->
  <div class="leaver-chooser" role="group" aria-label="Leaver annotation">
    <span class="leaver-chooser-label" aria-hidden="true">Leaver?</span>
    <button
      type="button"
      class="leaver-chip"
      :class="{ active: record.annotation?.leaver === 'self' }"
      :aria-pressed="record.annotation?.leaver === 'self'"
      title="Tag this match as: I left the game (data is incomplete)."
      @click="emit('set-leaver-annotation', record.match_key, record.annotation?.leaver === 'self' ? '' : 'self')"
    >
      <span class="leaver-chip-glyph leaver-self" aria-hidden="true">⊘</span>
      I left
    </button>
    <button
      type="button"
      class="leaver-chip"
      :class="{ active: record.annotation?.leaver === 'team' }"
      :aria-pressed="record.annotation?.leaver === 'team'"
      title="Tag this match as: an ally left."
      @click="emit('set-leaver-annotation', record.match_key, record.annotation?.leaver === 'team' ? '' : 'team')"
    >
      <span class="leaver-chip-glyph leaver-team" aria-hidden="true">↙</span>
      Ally left
    </button>
    <button
      type="button"
      class="leaver-chip"
      :class="{ active: record.annotation?.leaver === 'enemy' }"
      :aria-pressed="record.annotation?.leaver === 'enemy'"
      title="Tag this match as: an enemy left."
      @click="emit('set-leaver-annotation', record.match_key, record.annotation?.leaver === 'enemy' ? '' : 'enemy')"
    >
      <span class="leaver-chip-glyph leaver-enemy" aria-hidden="true">↗</span>
      Enemy left
    </button>
    <button
      v-if="record.annotation?.leaver"
      type="button"
      class="leaver-chip leaver-clear"
      title="Remove the leaver annotation."
      @click="emit('set-leaver-annotation', record.match_key, '')"
    >
      × Clear
    </button>
  </div>
</template>

<style scoped>
/* ─── Leaver chooser (expanded view) ────────────────────── */

/* Sits at the top of `.match-expanded` so the user reaches it
   without scrolling past stats / heroes. The label is
   mono-eyebrow style; the chips reuse the .badge visual
   vocabulary but are explicitly tagged with their own classes so
   they can be styled independently of the filter chips above. */
.leaver-chooser {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
  margin: 0 0 0.85rem;
  padding-bottom: 0.6rem;
  border-bottom: 1px dashed var(--border);
}

.leaver-chooser-label {
  margin-right: 0.4rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.leaver-chip {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.22rem 0.6rem;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  color: var(--text-dim);
  cursor: pointer;
  transition: color 140ms ease, background 140ms ease, border-color 140ms ease, transform 140ms ease;
}

.leaver-chip:hover {
  color: var(--text);
  border-color: var(--text-faint);
  transform: translateY(-1px);
}

.leaver-chip.active {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: var(--accent);
}

.leaver-chip.leaver-clear {
  margin-left: auto;
  color: var(--text-faint);
  font-size: 0.62rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.leaver-chip.leaver-clear:hover {
  color: var(--loss);
  border-color: var(--loss-line);
  background: var(--loss-soft);
}

.leaver-chip-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  line-height: 1;
}
.leaver-chip-glyph.leaver-self  { color: var(--loss); }
.leaver-chip-glyph.leaver-team  { color: var(--loss); }
.leaver-chip-glyph.leaver-enemy { color: var(--win); }
.leaver-chip.active .leaver-chip-glyph { color: var(--accent); }

</style>
