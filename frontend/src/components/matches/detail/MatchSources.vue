<script setup lang="ts">
import type { MatchRecord } from '@/api-client'
import {
  screenshotURL,
  detectScreenshotSlots,
  missingRequiredSlots,
  missingOptionalSlots,
  sshotTypeLabel,
  sourceType,
} from '@/match/match-helpers'
import { formatParsedAt } from '@/match/match-time-helpers'

// The expanded card's Sources block — the collapsible per-match screenshot
// list (coverage chips on the toggle row, inline previews, lightbox launch)
// plus the coverage-gap explainer below it. Extracted from
// MatchCardExpanded; the card threads the per-card source/preview UI state
// (isSourcesOpen / isPreviewOpen / hasPreviewError) + the filter-active
// predicate down and forwards the toggle / preview / lightbox / filter
// events up.
const props = defineProps<{
  record: MatchRecord
  isSourcesOpen: boolean
  isPreviewOpen: (filename: string) => boolean
  hasPreviewError: (filename: string) => boolean
  isActive: (field: string, value: string) => boolean
}>()

const emit = defineEmits<{
  'toggle-sources': []
  'toggle-preview': [filename: string]
  'preview-error':  [filename: string]
  'open-lightbox':  [filename: string, files: readonly string[], dirIDs: Record<string, number>]
  'filter-toggle':  [field: string, value: string]
}>()
</script>

<template>
  <div v-if="record.source_files?.length" class="sources-block">
    <div class="sources-toggle" @click="emit('toggle-sources')">
      <span class="chev small" :class="{ open: isSourcesOpen }">›</span>
      <span class="sources-label">Source Screenshots</span>
      <span class="sources-count">{{ record.source_files.length }}</span>
      <span class="sources-coverage" :title="`${detectScreenshotSlots(record).filter(s => s.present).length} of ${detectScreenshotSlots(record).length} screenshot types captured`">
        <component
          :is="slot.present ? 'button' : 'span'"
          v-for="slot in detectScreenshotSlots(record)"
          :key="slot.key"
          :type="slot.present ? 'button' : undefined"
          class="slot-chip"
          :class="{
            present: slot.present,
            absent: !slot.present,
            optional: !slot.required,
            'absent-required': !slot.present && slot.required,
            clickable: slot.present,
            active: slot.present && isActive('sshot', slot.key),
          }"
          :title="slot.present ? `Click to filter to matches that have a ${slot.label} screenshot. ${slot.hint}` : slot.hint"
          :aria-label="slot.present ? `Filter by source: ${slot.label} present` : `${slot.label} screenshot not captured`"
          :aria-pressed="slot.present ? isActive('sshot', slot.key) : undefined"
          @click.stop="slot.present && emit('filter-toggle', 'sshot', slot.key)"
        >
          <span class="slot-dot" aria-hidden="true" />
          {{ slot.label }}
          <span v-if="!slot.required" class="slot-optional-tag">opt</span>
        </component>
      </span>
    </div>
    <div v-if="isSourcesOpen" class="sources">
      <div v-for="f in record.source_files" :key="f" class="source-file">
        <div class="source-row">
          <a
            class="source-name"
            :href="screenshotURL(f, record.source_dir_ids?.[f] ?? 0)"
            :title="props.isPreviewOpen(f) ? 'Hide preview' : 'Show preview'"
            @click.prevent="emit('toggle-preview', f)"
          >
            <span class="chev small" :class="{ open: props.isPreviewOpen(f) }">›</span>
            <span class="source-name-text">{{ f }}</span>
          </a>
          <button
            type="button"
            class="source-type-chip clickable"
            :class="[
              `source-type-${sourceType(record, f)}`,
              { active: isActive('sshot', sourceType(record, f)) },
            ]"
            :aria-label="`Filter by source type: ${sshotTypeLabel(sourceType(record, f))}`"
            :aria-pressed="isActive('sshot', sourceType(record, f))"
            @click.stop="emit('filter-toggle', 'sshot', sourceType(record, f))"
          >
            {{ sshotTypeLabel(sourceType(record, f)) }}
          </button>
          <span
            v-if="record.source_parsed_at?.[f]"
            class="source-parsed-chip"
            :title="`Inserted into the database at ${record.source_parsed_at[f]} (UTC)`"
          >{{ formatParsedAt(record.source_parsed_at[f]) }}</span>
        </div>
        <img
          v-if="props.isPreviewOpen(f) && !props.hasPreviewError(f)"
          :src="screenshotURL(f, record.source_dir_ids?.[f] ?? 0)"
          :alt="f"
          class="source-preview"
          title="Click to view fullscreen"
          @click="emit('open-lightbox', f, record.source_files ?? [], record.source_dir_ids ?? {})"
          @error="emit('preview-error', f)"
        >
        <div v-if="props.isPreviewOpen(f) && props.hasPreviewError(f)" class="source-preview-error">
          Could not load image — check screenshots folder in Settings.
        </div>
      </div>
    </div>

    <div v-if="isSourcesOpen && (missingRequiredSlots(record).length || missingOptionalSlots(record).length)" class="sources-explain">
      <p v-for="slot in missingRequiredSlots(record)" :key="slot.key" class="coverage-line required">
        <span class="coverage-line-tag">⚠ {{ slot.label }} missing</span>
        <span class="coverage-line-text">
          Capture the post-match <strong>{{ slot.label }}</strong> tab and re-parse to recover: {{ slot.missing }}.
        </span>
      </p>
      <p v-for="slot in missingOptionalSlots(record)" :key="slot.key" class="coverage-line optional">
        <span class="coverage-line-tag">· {{ slot.label }} not captured</span>
        <span class="coverage-line-text">
          Optional — recommended for ranked matches. Provides: {{ slot.missing }}.
        </span>
      </p>
    </div>
  </div>
</template>

<style scoped>
/* ─── Coverage explainer (below sources) ─────────────────── */

.coverage-line {
  display: grid;
  grid-template-columns: minmax(9.5rem, max-content) 1fr;
  gap: 0.7rem;
  align-items: baseline;
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.4;
}

.coverage-line-tag {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-weight: 700;
  white-space: nowrap;
}

.coverage-line.required .coverage-line-tag { color: var(--accent-bright); }
.coverage-line.optional .coverage-line-tag { color: var(--text-faint); }

.coverage-line-text {
  color: var(--text-dim);
}

.coverage-line.required .coverage-line-text strong {
  color: var(--accent-bright);
  font-weight: 700;
}

/* Light-mode `.coverage-line.required` overrides live in app.css —
   the `:global([data-theme="light"]) .x` form miscompiles in Vue
   scoped CSS, see CLAUDE.md "Vue scoped miscompiles". */

@media (width <= 720px) {
  .coverage-line {
    grid-template-columns: 1fr;
    gap: 0.2rem;
  }
}


/* ─── Sources block ──────────────────────────────────────── */

.sources-block {
  margin-top: 0.2rem;
  border-top: 1px dashed var(--border);
  padding-top: 0.85rem;
}

.sources-toggle {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
  cursor: pointer;
  user-select: none;
  font-family: var(--mono);
  font-size: 0.65rem;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.18em;
  transition: color 160ms ease;
}
.sources-toggle:hover { color: var(--text-dim); }

.sources-count {
  font-family: var(--mono);
  background: var(--surface-3);
  color: var(--text-dim);
  padding: 0.05rem 0.4rem;
  border-radius: 2px;
  font-size: 0.6rem;
  letter-spacing: 0;
  margin-left: 0.2rem;
}

/* Coverage chips on the Sources toggle row — same .slot-chip styling
   as the legacy coverage-block, but pushed to the right of the
   "Source Screenshots · 5" label. */
.sources-coverage {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  margin-left: auto;
}

.sources-coverage .slot-chip.clickable {
  cursor: pointer;
}

.sources-coverage .slot-chip.clickable:hover {
  filter: brightness(1.12);
  transform: translateY(-1px);
}

.sources-coverage .slot-chip.active {
  box-shadow: 0 0 0 1px var(--accent), 0 0 0 3px var(--accent-soft);
}

.sources {
  margin-top: 0.55rem;
  padding: 0.65rem 0.75rem;
  background: rgb(0 0 0 / 30%);
  border: 1px solid var(--border-soft);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.72rem;
}

/* .source-file / .source-name-text / .source-parsed-chip live in
   app.css — they're also used by UnknownMapsView. .source-row stays
   here (MatchCardExpanded-only). */

.source-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.source-type-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  padding: 0.18rem 0.5rem;
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  border: 1px solid transparent;
  flex-shrink: 0;
  cursor: default;
  user-select: none;
  transition: filter 140ms ease, transform 140ms ease, box-shadow 140ms ease;
}

.source-type-chip.clickable { cursor: pointer; }

.source-type-chip.clickable:hover {
  filter: brightness(1.15);
  transform: translateY(-1px);
}

.source-type-chip.active {
  box-shadow: 0 0 0 1px var(--accent), 0 0 0 3px var(--accent-soft);
}

.source-type-summary {
  background: var(--accent-soft);
  border-color: rgb(245 166 35 / 50%);
  color: var(--accent-bright);
}

.source-type-scoreboard {
  background: rgb(106 184 255 / 12%);
  border-color: rgb(106 184 255 / 50%);
  color: var(--tank);
}

.source-type-personal {
  background: rgb(125 255 172 / 12%);
  border-color: rgb(125 255 172 / 50%);
  color: var(--support);
}

.source-type-rank {
  background: rgb(255 201 77 / 14%);
  border-color: rgb(255 201 77 / 50%);
  color: var(--draw);
}

/* Light-mode `.source-type-summary` / `.hero-name` / `.sources`
   overrides live in app.css — the `:global([data-theme="light"]) .x`
   form miscompiles in Vue scoped CSS, see CLAUDE.md. */

.sources-explain {
  margin-top: 0.7rem;
  padding-top: 0.65rem;
  border-top: 1px dashed var(--hairline);
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

</style>
